/**
 * Orders routes: create, list, fetch, update, and delete orders.
 *
 * @module routes/orders
 * @param {Object} knex - Knex query builder instance for DB access.
 *
 * Exposes:
 * - POST   /orders        -> create an order (supports logged-in or guest payload)
 * - GET    /orders        -> list orders for the logged-in user
 * - GET    /orders/:id    -> fetch a single order (owner or staff)
 * - PATCH  /orders/:id    -> update order items (owner or staff)
 * - DELETE /orders/:id    -> delete an order (owner only)
 *
 * Notes:
 * - Auth is enforced via `isLoggedIn` middleware which attaches `req.user`.
 * - Phone and email fields are normalized for API responses.
 * - Writes that affect multiple tables are performed inside transactions.
 */
const express = require('express');
const isLoggedInFactory = require('../middlewares/isLoggedIn');

module.exports = function (knex) {
    const router = express.Router();
    const isLoggedIn = isLoggedInFactory(knex);

    // POST /orders
    // Body shape (examples):
    // {
    //   user_id?: number,              // optional override of logged-in user
    //   guest_name?: string,
    //   guest_phone?: string,
    //   pickup_time?: string | null,
    //   staff_note?: string,
    //   items: [
    //     { menu_item_id: number, quantity: number, unit_price?: number, notes?: string },
    //     ...
    //   ]
    // }
    router.post('/', isLoggedIn, async (req, res) => {
        const { user_id, guest_name, guest_phone, pickup_time, staff_note, items } = req.body || {};

        // Prefer explicit user_id otherwise use authenticated user id (if available)
        const resolvedUserId = (typeof user_id === 'number')
            ? user_id
            : (req.user && typeof req.user.id === 'number' ? req.user.id : null);

        // Validate items array presence and shape
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: '`items` array is required and cannot be empty' });
        }
        for (const it of items) {
            if (!it || typeof it.menu_item_id !== 'number' || Number(it.quantity) <= 0) {
                return res.status(400).json({ error: 'Each item must have a numeric `menu_item_id` and a positive `quantity`' });
            }
        }

        try {
            // Use a transaction to atomically create order and order_items
            const created = await knex.transaction(async (trx) => {
                // Load prices for involved menu items in bulk
                const ids = [...new Set(items.map(i => i.menu_item_id))];
                const menuRows = await trx('menu_items').whereIn('id', ids).select('id', 'price');
                const priceMap = Object.fromEntries(menuRows.map(r => [r.id, r.price]));

                // Build order items, using provided unit_price or price from menu
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

                // Compute total and prepare order payload
                const total = orderItems.reduce((s, it) => s + it.line_total, 0);
                const orderPayload = {
                    user_id: resolvedUserId || null,
                    guest_name: guest_name || null,
                    guest_phone: guest_phone || null,
                    total,
                    pickup_time: pickup_time || null,
                    staff_note: staff_note || null
                };

                // Insert order — handle varying DB return shapes (`returning` vs insert id)
                let createdOrder;
                try {
                    const rows = await trx('orders').insert(orderPayload).returning('*');
                    createdOrder = Array.isArray(rows) ? rows[0] : rows;
                } catch (e) {
                    // Fallback: insert returns id array on some adapters
                    const [newId] = await trx('orders').insert(orderPayload);
                    createdOrder = await trx('orders').where('id', newId).first();
                }

                // Insert order items linking to created order id
                const itemsToInsert = orderItems.map(it => ({ ...it, order_id: createdOrder.id }));
                await trx('order_items').insert(itemsToInsert);

                // Attach created items to response object
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
    // Returns orders for the authenticated user (req.user)
    router.get('/', isLoggedIn, async (req, res) => {
        const loggedUserId = req.user && req.user.id;

        // Normalize phone values to digits-only string or null
        const normalizePhone = (p) => {
            if (!p && p !== 0) return null;
            const norm = String(p).replace(/\D+/g, '');
            return norm.length ? norm : null;
        };

        try {
            // Load orders for this user
            const orders = await knex('orders')
                .select('*')
                .where('user_id', loggedUserId)
                .orderBy('id', 'desc');

            // Bulk load related order_items and menu item names to avoid N+1 queries
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

            // Group items by order id and enrich with menu item name
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

            // Attach minimal user info for the response (normalize email and phone)
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
    // Fetch a single order — only the owner or staff may view
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

            // Authorization: either owner (user_id) or staff flag
            const loggedUserId = req.user && req.user.id;
            const isStaff = req.user && req.user.is_staff;
            if (order.user_id && loggedUserId !== order.user_id && !isStaff) {
                return res.status(403).json({ error: 'Not authorized to view this order' });
            }

            // Load items and menu names in batch
            const items = await knex('order_items').where('order_id', orderId).select('*');
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

            // Attach minimal user info for order owner if present
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


    // PATCH /orders/:id
    // Update order items: supports deleting lines, changing quantities/notes.
    // Body example:
    // {
    //   user_id?: number,       // required for authorization in this implementation
    //   items: [ { id?: number, order_item_id?: number, menu_item_id?: number, quantity?: number, notes?: string, delete?: true }, ... ]
    // }
    router.patch('/:id', isLoggedIn, async (req, res) => {
        const orderId = Number(req.params.id);
        const { user_id, items } = req.body || {};

        if (!orderId || Number.isNaN(orderId)) {
            return res.status(400).json({ error: 'Invalid order id' });
        }
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: '`items` array is required and cannot be empty' });
        }

        // Authorization: require user_id or use authenticated user id
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

            // Transactional update of order items and order total
            const updated = await knex.transaction(async (trx) => {
                for (const it of items) {
                    if (!it || typeof it !== 'object') continue;

                    // Determine the target order_item by id or menu_item_id
                    const orderItemIdRaw = it.id ?? it.order_item_id;
                    const maybeId = (orderItemIdRaw !== undefined && orderItemIdRaw !== null) ? Number(orderItemIdRaw) : null;
                    const menuItemIdRaw = it.menu_item_id ?? null;
                    const menuItemId = (menuItemIdRaw !== undefined && menuItemIdRaw !== null) ? Number(menuItemIdRaw) : null;

                    if ((!maybeId || Number.isNaN(maybeId) || maybeId <= 0) && (!menuItemId || Number.isNaN(menuItemId) || menuItemId <= 0)) {
                        throw { status: 400, message: 'Each item must include an existing order item `id` or a `menu_item_id`' };
                    }

                    // Find existing order_item record in the order
                    let existing = null;
                    if (maybeId && !Number.isNaN(maybeId) && maybeId > 0) {
                        existing = await trx('order_items').where({ id: maybeId, order_id: orderId }).first();
                    }
                    if (!existing && menuItemId && !Number.isNaN(menuItemId) && menuItemId > 0) {
                        existing = await trx('order_items').where({ order_id: orderId, menu_item_id: menuItemId }).first();
                    }

                    if (!existing) {
                        if (it.delete) continue; // nothing to delete
                        throw { status: 400, message: `Order item ${maybeId ?? menuItemId} not found on this order` };
                    }

                    // If delete flag set, remove the line
                    if (it.delete) {
                        await trx('order_items').where({ id: existing.id }).del();
                        continue;
                    }

                    // Update quantity (recalculate line_total) or just notes
                    if (it.quantity !== undefined) {
                        const quantity = Math.max(0, Math.floor(Number(it.quantity) || 0));
                        if (Number.isNaN(quantity)) {
                            throw { status: 400, message: `Invalid quantity for order item ${existing.id}` };
                        }
                        if (quantity <= 0) {
                            // remove this line when quantity drops to zero
                            await trx('order_items').where({ id: existing.id }).del();
                            continue;
                        }

                        // Determine unit_price (fallback to menu price when missing)
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
                        // Only update notes if provided
                        await trx('order_items').where({ id: existing.id }).update({ notes: it.notes });
                    }
                }

                // Re-fetch remaining items to recalc total
                const remainingItems = await trx('order_items').where('order_id', orderId).select('*');

                // If no items remain, delete the order and return a deletion sentinel
                if (!remainingItems || remainingItems.length === 0) {
                    await trx('orders').where('id', orderId).del();
                    return { deleted: true, id: orderId };
                }

                // Recalculate total and persist
                const total = remainingItems.reduce((s, it) => s + Number(it.line_total || 0), 0);
                await trx('orders').where('id', orderId).update({ total });

                // Build updated order payload with enriched items and optional user info
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

            // Deleted sentinel -> 204 No Content
            if (updated && updated.deleted) {
                return res.status(204).end();
            }

            return res.status(200).json({ order: updated });
        } catch (err) {
            // Bubble through structured errors thrown above
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
    //   user_id: number // required to authorize deletion
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

            // Use a transaction to delete items and order atomically
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
