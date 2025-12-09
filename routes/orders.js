// javascript
const express = require('express');
const isLoggedInFactory = require('../middlewares/isLoggedIn');

module.exports = function (knex) {
    const router = express.Router();
    const isLoggedIn = isLoggedInFactory(knex);

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
    router.post('/', isLoggedIn, async (req, res) => {
        const { user_id, guest_name, guest_phone, pickup_time, staff_note, items } = req.body || {};

        // prefer provided user_id, otherwise use logged-in user id
        const resolvedUserId = (typeof user_id === 'number')
            ? user_id
            : (req.user && typeof req.user.id === 'number' ? req.user.id : null);

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
                    user_id: resolvedUserId || null,
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
    router.get('/', isLoggedIn, async (req, res) => {
        const loggedUserId = req.user && req.user.id;

        const normalizePhone = (p) => {
            if (!p && p !== 0) return null;
            const norm = String(p).replace(/\D+/g, '');
            return norm.length ? norm : null;
        };

        try {
            const orders = await knex('orders')
                .select('*')
                .where('user_id', loggedUserId)
                .orderBy('id', 'desc');

            const orderIds = orders.map(o => o.id).filter(id => id != null);
            const allItems = orderIds.length
                ? await knex('order_items').whereIn('order_id', orderIds).select('*')
                : [];

            const menuItemIds = Array.from(new Set(allItems.map(it => it.menu_item_id).filter(id => id != null)));
            const menuItems = menuItemIds.length
                ? await knex('menu_items').whereIn('id', menuItemIds).select('id', 'name')
                : [];
            const menuById = {};
            menuItems.forEach(m => { menuById[String(m.id)] = m.name; });

            // group and enrich items by order, ensure menu_item_id is present (numeric) and add menu_item_name
            const itemsByOrder = {};
            allItems.forEach(it => {
                const menuItemIdNum = (it.menu_item_id !== undefined && it.menu_item_id !== null) ? Number(it.menu_item_id) : null;
                const enriched = {
                    ...it,
                    menu_item_id: menuItemIdNum,
                    menu_item_name: menuById[String(menuItemIdNum)] ?? null
                };
                (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push(enriched);
            });

            const userRow = await knex('users')
                .where('id', loggedUserId)
                .first('id', 'name', 'email', 'phone');

            const user = userRow ? {
                id: userRow.id,
                name:  userRow.name,
                email: userRow.email ? String(userRow.email).toLowerCase() : null,
                phone: normalizePhone(userRow.phone)
            } : null;

            const ordersWithItemsAndUser = orders.map(o => {
                const items = itemsByOrder[o.id] || [];
                return { ...o, items, user };
            });

            return res.json(ordersWithItemsAndUser);
        } catch (err) {
            console.error('Error fetching orders:', err);
            return res.status(500).json({ error: 'Failed to fetch orders' });
        }
    });

// GET /orders/:id
    router.get('/:id', isLoggedIn, async (req, res) => {
        const orderId = Number(req.params.id);
        if (!orderId || Number.isNaN(orderId)) {
            return res.status(400).json({ error: 'Invalid order id' });
        }

        const normalizePhone = (p) => {
            if (p === undefined || p === null) return null;
            const s = String(p).replace(/\D+/g, '');
            return s.length ? s : null;
        };

        try {
            const order = await knex('orders').where('id', orderId).first();
            if (!order) return res.status(404).json({ error: 'Order not found' });

            // authorize: owner or staff
            const loggedUserId = req.user && req.user.id;
            const isStaff = req.user && req.user.is_staff;
            if (order.user_id && loggedUserId !== order.user_id && !isStaff) {
                return res.status(403).json({ error: 'Not authorized to view this order' });
            }

            const items = await knex('order_items').where('order_id', orderId).select('*');

            // load menu item names in batch
            const menuItemIds = Array.from(new Set(items.map(i => i.menu_item_id).filter(id => id != null)));
            const menuItems = menuItemIds.length
                ? await knex('menu_items').whereIn('id', menuItemIds).select('id', 'name')
                : [];
            const menuById = {};
            menuItems.forEach(m => { menuById[String(m.id)] = m.name; });

            const enrichedItems = items.map(it => {
                const mid = (it.menu_item_id !== undefined && it.menu_item_id !== null) ? Number(it.menu_item_id) : null;
                return {
                    ...it,
                    menu_item_id: mid,
                    menu_item_name: menuById[String(mid)] ?? null
                };
            });

            // attach minimal user info for the order owner (if present)
            let user = null;
            if (order.user_id) {
                const userRow = await knex('users')
                    .where('id', order.user_id)
                    .first('id', 'username', 'name', 'email', 'phone', 'phone_number');

                if (userRow) {
                    user = {
                        id: userRow.id,
                        name: userRow.name,
                        email: userRow.email ? String(userRow.email).toLowerCase() : null,
                        phone: normalizePhone(userRow.phone)
                    };
                }
            }

            order.items = enrichedItems;
            order.user = user;
            return res.json(order);
        } catch (err) {
            console.error('Error fetching order:', err);
            return res.status(500).json({ error: 'Failed to fetch order' });
        }
    });


    router.patch('/:id', isLoggedIn, async (req, res) => {
        const orderId = Number(req.params.id);
        const { user_id, items } = req.body || {};

        if (!orderId || Number.isNaN(orderId)) {
            return res.status(400).json({ error: 'Invalid order id' });
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: '`items` array is required and cannot be empty' });
        }

        const authUserId = Number(user_id ?? (req.user && req.user.id));
        if (!authUserId || Number.isNaN(authUserId)) {
            return res.status(400).json({ error: '`user_id` is required for authorization' });
        }

        try {
            const order = await knex('orders').where('id', orderId).first();
            if (!order) return res.status(404).json({ error: 'Order not found' });

            const isStaff = req.user && req.user.is_staff;
            if (order.user_id !== authUserId && !isStaff) {
                return res.status(403).json({ error: 'Not authorized to modify this order' });
            }

            const updated = await knex.transaction(async (trx) => {
                for (const it of items) {
                    if (!it || typeof it !== 'object') continue;

                    const orderItemIdRaw = it.id ?? it.order_item_id;
                    const maybeId = (orderItemIdRaw !== undefined && orderItemIdRaw !== null) ? Number(orderItemIdRaw) : null;
                    const menuItemIdRaw = it.menu_item_id ?? null;
                    const menuItemId = (menuItemIdRaw !== undefined && menuItemIdRaw !== null) ? Number(menuItemIdRaw) : null;

                    if ((!maybeId || Number.isNaN(maybeId) || maybeId <= 0) && (!menuItemId || Number.isNaN(menuItemId) || menuItemId <= 0)) {
                        throw { status: 400, message: 'Each item must include an existing order item `id` or a `menu_item_id`' };
                    }

                    let existing = null;
                    if (maybeId && !Number.isNaN(maybeId) && maybeId > 0) {
                        existing = await trx('order_items').where({ id: maybeId, order_id: orderId }).first();
                    }
                    if (!existing && menuItemId && !Number.isNaN(menuItemId) && menuItemId > 0) {
                        existing = await trx('order_items').where({ order_id: orderId, menu_item_id: menuItemId }).first();
                    }

                    if (!existing) {
                        if (it.delete) continue;
                        throw { status: 400, message: `Order item ${maybeId ?? menuItemId} not found on this order` };
                    }

                    if (it.delete) {
                        await trx('order_items').where({ id: existing.id }).del();
                        continue;
                    }

                    if (it.quantity !== undefined) {
                        const quantity = Math.max(0, Math.floor(Number(it.quantity) || 0));
                        if (Number.isNaN(quantity)) {
                            throw { status: 400, message: `Invalid quantity for order item ${existing.id}` };
                        }
                        if (quantity <= 0) {
                            // remove this line
                            await trx('order_items').where({ id: existing.id }).del();
                            continue;
                        }

                        let unit_price = existing.unit_price;
                        if (typeof unit_price !== 'number') {
                            const menuRow = await trx('menu_items').where('id', existing.menu_item_id).first('price');
                            unit_price = (menuRow && typeof menuRow.price === 'number') ? menuRow.price : 0;
                        }
                        const line_total = Math.round(unit_price * quantity);
                        await trx('order_items').where({ id: existing.id }).update({
                            quantity,
                            line_total,
                            notes: it.notes ?? existing.notes
                        });
                    } else if (it.notes !== undefined) {
                        await trx('order_items').where({ id: existing.id }).update({ notes: it.notes });
                    }
                }

                // fetch remaining items after updates
                const remainingItems = await trx('order_items').where('order_id', orderId).select('*');

                // if no remaining items, delete the order entirely
                if (!remainingItems || remainingItems.length === 0) {
                    await trx('orders').where('id', orderId).del();
                    // return a sentinel to indicate deletion
                    return { deleted: true, id: orderId };
                }

                // recalc total from remaining items
                const total = remainingItems.reduce((s, it) => s + Number(it.line_total || 0), 0);
                await trx('orders').where('id', orderId).update({ total });

                const updatedOrder = await trx('orders').where('id', orderId).first();

                const menuItemIds = Array.from(new Set(remainingItems.map(i => i.menu_item_id).filter(id => id != null)));
                const menuItems = menuItemIds.length ? await trx('menu_items').whereIn('id', menuItemIds).select('id', 'name') : [];
                const menuById = {};
                menuItems.forEach(m => { menuById[String(m.id)] = m.name; });

                updatedOrder.items = remainingItems.map(it => ({
                    ...it,
                    menu_item_id: (it.menu_item_id !== undefined && it.menu_item_id !== null) ? Number(it.menu_item_id) : null,
                    menu_item_name: menuById[String(it.menu_item_id)] ?? null
                }));

                if (updatedOrder.user_id) {
                    const userRow = await trx('users').where('id', updatedOrder.user_id).first('id', 'name', 'email', 'phone');
                    const normalizePhone = (p) => { if (p === undefined || p === null) return null; const s = String(p).replace(/\D+/g, ''); return s.length ? s : null; };
                    updatedOrder.user = userRow ? {
                        id: userRow.id,
                        name: userRow.name,
                        email: userRow.email ? String(userRow.email).toLowerCase() : null,
                        phone: normalizePhone(userRow.phone)
                    } : null;
                } else {
                    updatedOrder.user = null;
                }

                return updatedOrder;
            });

            // if deleted sentinel returned, respond 204 No Content
            if (updated && updated.deleted) {
                return res.status(204).end();
            }

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
    router.delete('/:id', isLoggedIn, async (req, res) => {
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
