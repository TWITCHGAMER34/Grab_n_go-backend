// javascript
// `routes/staff.js`
const express = require('express');
const { verifyPassword } = require('../utils/password');
const { isStaffMiddleware } = require('../middlewares/isStaff');

module.exports = function (knex) {
    const router = express.Router();

    // POST /staff/login
    router.post('/login', async (req, res) => {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

        try {
            const user = await knex('users').where({ email }).first();
            if (!user) return res.status(401).json({ error: 'Invalid email or password' });

            const hash = user.password_hash || user.password;
            if (!hash) return res.status(500).json({ error: 'No password hash on user' });

            const isPasswordValid = verifyPassword(password, hash);
            if (!isPasswordValid) return res.status(401).json({ error: 'Invalid email or password' });

            const isStaff = user.role === 'staff' || user.role === 'admin' || !!(user.is_staff || user.isStaff || user.staff);
            if (!isStaff) return res.status(403).json({ error: 'Forbidden: staff only' });

            if (req.session) {
                req.session.user = { id: user.id, email: user.email, role: user.role, is_staff: true };
                req.session.save(err => {
                    if (err) {
                        console.error('Session save error:', err);
                        return res.status(500).json({ error: 'Failed to create session' });
                    }
                    const { password_hash: _ph, password: _p, ...safe } = user;
                    res.json({ user: safe });
                });
            } else {
                const { password_hash: _ph, password: _p, ...safe } = user;
                res.json({ user: safe });
            }
        } catch (err) {
            console.error('Error logging in staff:', err);
            res.status(500).json({ error: 'Failed to login user' });
        }
    });


    // GET /staff/all - returns orders with items and owner (user or guest)
// file: `routes/staff.js` - updated GET /all handler
    router.get('/all', isStaffMiddleware, async (req, res) => {
        try {
            const orders = await knex('orders').select('*').orderBy('id', 'desc');

            // load minimal users and map by id
            const users = await knex('users').select('id', 'name', 'email', 'phone');
            const usersById = {};
            users.forEach(u => {
                if (u.id == null) return;
                usersById[String(u.id)] = {
                    id: u.id,
                    name: u.name,
                    email: u.email,
                    phone: u.phone
                };
            });

            // load all order items once
            const orderIds = orders.map(o => o.id).filter(id => id != null);
            const allItems = orderIds.length
                ? await knex('order_items').whereIn('order_id', orderIds).select('*')
                : [];

            // collect referenced menu_item ids and load menu items
            const menuItemIds = Array.from(new Set(allItems.map(it => it.menu_item_id).filter(id => id != null)));
            const menuItems = menuItemIds.length
                ? await knex('menu_items').whereIn('id', menuItemIds).select('id', 'name')
                : [];
            const menuById = {};
            menuItems.forEach(m => {
                menuById[String(m.id)] = { id: m.id, name: m.name };
            });

            // build items by order and enrich each item with menu_item_name
            const itemsByOrder = {};
            allItems.forEach(it => {
                const enriched = { ...it, menu_item_name: menuById[String(it.menu_item_id)]?.name ?? null };
                (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push(enriched);
            });

            // attach items and matched user (by order.user_id -> users.id)
            const ordersWithItemsAndUser = orders.map(o => {
                const items = itemsByOrder[o.id] || [];
                const ownerId = o.user_id;
                const user = ownerId != null ? usersById[String(ownerId)] || null : null;
                return { ...o, items, user };
            });

            return res.json(ordersWithItemsAndUser);
        } catch (err) {
            console.error('Error fetching all orders for staff:', err);
            return res.status(500).json({ error: 'Failed to fetch orders' });
        }
    });

    router.post('/addComment/:orderId', isStaffMiddleware, async (req, res) => {
        const { orderId } = req.params;
        const { comment } = req.body;

        if (!comment || typeof comment !== 'string' || comment.trim() === '') {
            return res.status(400).json({ error: 'Comment is required and must be a non-empty string' });
        }

        try {
            const order = await knex('orders').where({ id: orderId }).first();
            if (!order) {
                return res.status(404).json({ error: 'Order not found' });
            }

            await knex('orders')
                .where({ id: orderId })
                .update({ staff_note: comment.trim() });

            return res.json({ message: 'Comment added successfully' });
        } catch (err) {
            console.error('Error adding comment to order:', err);
            return res.status(500).json({ error: 'Failed to add comment to order' });
        }
    })

    router.post('/lock-order/:orderId', isStaffMiddleware, async (req, res) => {
        const { orderId } = req.params;

        try {
            const order = await knex('orders').where({ id: orderId }).first();
            if (!order) {
                return res.status(404).json({ error: 'Order not found' });
            }

            await knex('orders')
                .where({ id: orderId })
                .update({ locked: true, status: 'in_kitchen' });

            return res.json({ message: 'Order locked successfully' });
        }
        catch (err) {
            console.error('Error locking order:', err);
            return res.status(500).json({ error: 'Failed to lock order' });
        }
    })

    router.patch('/status/:id', isStaffMiddleware, async (req, res) => {
        const orderId = Number(req.params.id);
        const { status } = req.body || {};

        if (!orderId || Number.isNaN(orderId)) {
            return res.status(400).json({ error: 'Invalid order id' });
        }
        const validStatuses = ['pending','in_kitchen','ready','completed','cancelled'];
        if (typeof status !== 'string' || !validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        try {
            const updated = await knex('orders').where('id', orderId).update({ status }).returning('*');
            const updatedOrder = Array.isArray(updated) ? updated[0] : updated;
            if (!updatedOrder) {
                return res.status(404).json({ error: 'Order not found' });
            }

            // If status moved to completed, schedule removal after 5 seconds
            if (status === 'completed') {
                setTimeout(async () => {
                    try {
                        // verify order still exists and is still completed
                        const current = await knex('orders').where({ id: orderId }).first();
                        if (!current) {
                            console.log(`Order ${orderId} already removed before scheduled deletion.`);
                            return;
                        }
                        if (current.status !== 'completed') {
                            console.log(`Order ${orderId} status changed to ${current.status}; skipping deletion.`);
                            return;
                        }

                        // delete order items and the order in a transaction
                        await knex.transaction(async trx => {
                            await trx('order_items').where({ order_id: orderId }).del();
                            await trx('orders').where({ id: orderId }).del();
                        });

                        console.log(`Order ${orderId} and its items removed after completion.`);
                    } catch (err) {
                        console.error(`Error removing completed order ${orderId}:`, err);
                    }
                }, 60000);
            }

            return res.status(200).json({ order: updatedOrder });
        } catch (err) {
            console.error('Error updating order status:', err);
            return res.status(500).json({ error: 'Failed to update order status' });
        }
    });



    return router;
};