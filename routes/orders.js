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

    return router;
};
