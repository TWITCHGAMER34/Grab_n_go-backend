// javascript
const express = require('express');

module.exports = function (knex) {
    const router = express.Router();

    // POST /orders
    // Body shape:
    // {
    //   user_id?: number,
    //   guest_name?: string,
    //   guest_phone?: string,
    //   pickup_time?: string (ISO) | null,
    //   staff_note?: string,
    //   items: [
    //     { menu_item_id: number, quantity: number, unit_price?: number, notes?: string },
    //     ...
    //   ]
    // }
    router.post('/', async (req, res) => {
        const { user_id, guest_name, guest_phone, pickup_time, staff_note, items } = req.body || {};

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: '`items` array is required and cannot be empty' });
        }

        for (const it of items) {
            if (!it || typeof it.menu_item_id !== 'number' || Number(it.quantity) <= 0) {
                return res.status(400).json({ error: 'Each item must have a numeric `menu_item_id` and a positive `quantity`' });
            }
        }

        try {
            const created = await knex.transaction(async (trx) => {
                const ids = [...new Set(items.map(i => i.menu_item_id))];
                const menuRows = await trx('menu_items').whereIn('id', ids).select('id', 'price');
                const priceMap = Object.fromEntries(menuRows.map(r => [r.id, r.price]));

                const orderItems = items.map(i => {
                    const quantity = Number(i.quantity) || 1;
                    const unit_price = (typeof i.unit_price === 'number') ? i.unit_price : (priceMap[i.menu_item_id] ?? 0);
                    const line_total = Math.round(unit_price * quantity);
                    return {
                        menu_item_id: i.menu_item_id,
                        quantity,
                        unit_price,
                        line_total,
                        notes: i.notes || null
                    };
                });

                const total = orderItems.reduce((s, it) => s + it.line_total, 0);

                const orderPayload = {
                    user_id: user_id || null,
                    guest_name: guest_name || null,
                    guest_phone: guest_phone || null,
                    total,
                    pickup_time: pickup_time || null,
                    staff_note: staff_note || null
                };

                let createdOrder;
                try {
                    const rows = await trx('orders').insert(orderPayload).returning('*');
                    createdOrder = Array.isArray(rows) ? rows[0] : rows;
                } catch (e) {
                    const [newId] = await trx('orders').insert(orderPayload);
                    createdOrder = await trx('orders').where('id', newId).first();
                }

                const itemsToInsert = orderItems.map(it => ({ ...it, order_id: createdOrder.id }));
                await trx('order_items').insert(itemsToInsert);

                createdOrder.items = itemsToInsert;
                return createdOrder;
            });

            return res.status(201).json({ order: created });
        } catch (err) {
            console.error('Error creating order:', err);
            return res.status(500).json({ error: 'Failed to create order' });
        }
    });


    // GET /orders?user_id=123
    router.get('/', async (req, res) => {
        const rawUserId = req.query.user_id;
        const userId = rawUserId !== undefined ? Number(rawUserId) : null;
        if (rawUserId !== undefined && Number.isNaN(userId)) {
            return res.status(400).json({ error: 'Invalid user_id' });
        }

        try {
            let q = knex('orders').select('*');
            if (userId !== null) q = q.where('user_id', userId);
            const orders = await q.orderBy('id', 'desc');

            const ordersWithItems = await Promise.all(
                orders.map(async (o) => {
                    const items = await knex('order_items').where('order_id', o.id).select('*');
                    return { ...o, items };
                })
            );

            return res.json(ordersWithItems);
        } catch (err) {
            console.error('Error fetching orders:', err);
            return res.status(500).json({ error: 'Failed to fetch orders' });
        }
    });

// GET /orders/:id
    router.get('/:id', async (req, res) => {
        const orderId = Number(req.params.id);
        if (!orderId || Number.isNaN(orderId)) {
            return res.status(400).json({ error: 'Invalid order id' });
        }

        try {
            const order = await knex('orders').where('id', orderId).first();
            if (!order) return res.status(404).json({ error: 'Order not found' });

            const items = await knex('order_items').where('order_id', orderId).select('*');
            order.items = items;

            return res.json(order);
        } catch (err) {
            console.error('Error fetching order:', err);
            return res.status(500).json({ error: 'Failed to fetch order' });
        }
    });


    // PATCH /orders/:id
    // Body shape:
    // {
    //   user_id: number, // required to authorize
    //   items: [
    //     { menu_item_id: number, quantity?: number, delete?: boolean },
    //     ...
    //   ]
    // }
    router.patch('/:id', async (req, res) => {
        const orderId = Number(req.params.id);
        const { user_id, items } = req.body || {};

        if (!orderId || Number.isNaN(orderId)) {
            return res.status(400).json({ error: 'Invalid order id' });
        }
        if (typeof user_id !== 'number') {
            return res.status(400).json({ error: '`user_id` is required for authorization' });
        }
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: '`items` array is required and cannot be empty' });
        }

        try {
            const order = await knex('orders').where('id', orderId).first();
            if (!order) return res.status(404).json({ error: 'Order not found' });
            if (order.user_id !== user_id) return res.status(403).json({ error: 'Not authorized to modify this order' });

            const updated = await knex.transaction(async (trx) => {
                for (const it of items) {
                    const menu_item_id = Number(it.menu_item_id);
                    if (!menu_item_id || Number.isNaN(menu_item_id)) {
                        throw { status: 400, message: 'Each item must have a valid `menu_item_id`' };
                    }

                    const existing = await trx('order_items')
                        .where({ order_id: orderId, menu_item_id })
                        .first();

                    if (!existing) {
                        throw { status: 400, message: `Order item with menu_item_id ${menu_item_id} not found on this order` };
                    }

                    if (it.delete) {
                        await trx('order_items').where({ id: existing.id }).del();
                        continue;
                    }

                    if (typeof it.quantity === 'number') {
                        const quantity = Math.max(0, Math.floor(it.quantity));
                        if (quantity <= 0) {
                            // treat zero or negative as delete
                            await trx('order_items').where({ id: existing.id }).del();
                            continue;
                        }

                        // Determine unit_price (prefer stored unit_price, fallback to menu_items.price)
                        let unit_price = existing.unit_price;
                        if (typeof unit_price !== 'number') {
                            const menuRow = await trx('menu_items').where('id', menu_item_id).first('price');
                            unit_price = (menuRow && menuRow.price) ? menuRow.price : 0;
                        }

                        const line_total = Math.round(unit_price * quantity);
                        await trx('order_items')
                            .where({ id: existing.id })
                            .update({ quantity, line_total, notes: it.notes ?? existing.notes });
                    }
                }

                // Recalculate order total
                const sumRow = await trx('order_items').where('order_id', orderId).sum('line_total as total').first();
                const total = Number(sumRow && sumRow.total) || 0;
                await trx('orders').where('id', orderId).update({ total });

                const updatedOrder = await trx('orders').where('id', orderId).first();
                const updatedItems = await trx('order_items').where('order_id', orderId).select('*');
                updatedOrder.items = updatedItems;
                return updatedOrder;
            });

            return res.status(200).json({ order: updated });
        } catch (err) {
            if (err && err.status && err.message) {
                return res.status(err.status).json({ error: err.message });
            }
            console.error('Error updating order:', err);
            return res.status(500).json({ error: 'Failed to update order' });
        }
    });

    // DELETE /orders/:id
    // Body shape:
    // {
    //   user_id: number // required to authorize
    // }
    router.delete('/:id', async (req, res) => {
        const orderId = Number(req.params.id);
        const { user_id } = req.body || {};

        if (!orderId || Number.isNaN(orderId)) {
            return res.status(400).json({ error: 'Invalid order id' });
        }
        if (typeof user_id !== 'number') {
            return res.status(400).json({ error: '`user_id` is required for authorization' });
        }

        try {
            const order = await knex('orders').where('id', orderId).first();
            if (!order) return res.status(404).json({ error: 'Order not found' });
            if (order.user_id !== user_id) return res.status(403).json({ error: 'Not authorized to delete this order' });

            await knex.transaction(async (trx) => {
                await trx('order_items').where('order_id', orderId).del();
                await trx('orders').where('id', orderId).del();
            });

            return res.status(204).end();
        } catch (err) {
            console.error('Error deleting order:', err);
            return res.status(500).json({ error: 'Failed to delete order' });
        }
    });

    return router;
};
