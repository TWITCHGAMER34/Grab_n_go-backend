// javascript
/**
 * Staff routes: authentication and staff-only order management.
 *
 * @module routes/staff
 * @param {Object} knex - Knex query builder instance used for DB access.
 *
 * Exposes:
 * - POST  /staff/login                 -> staff login (creates session when available)
 * - GET   /staff/all                   -> list all orders with items and owners (staff-only)
 * - POST  /staff/addComment/:orderId   -> add or replace staff comment on an order
 * - POST  /staff/lock-order/:orderId   -> mark order as locked and set status to in_kitchen
 * - PATCH /staff/status/:id            -> update order status (schedules removal when completed)
 *
 * Notes:
 * - Authorization enforced via `isStaffMiddleware`.
 * - Responses avoid leaking password hashes by stripping sensitive fields.
 * - Completed orders are scheduled for removal after a delay only when still completed.
 */
const express = require('express');
const { verifyPassword } = require('../utils/password');
const { isStaffMiddleware } = require('../middlewares/isStaff');

module.exports = function (knex) {
    const router = express.Router();

    // POST /staff/login
    // Accepts email+password; verifies credentials and creates a session user marked as staff.
    router.post('/login', async (req, res) => {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

        try {
            // Load user by email
            const user = await knex('users').where({ email }).first();
            if (!user) return res.status(401).json({ error: 'Invalid email or password' });

            // Support legacy column names: password_hash or password
            const hash = user.password_hash || user.password;
            if (!hash) return res.status(500).json({ error: 'No password hash on user' });

            // Verify password
            const isPasswordValid = verifyPassword(password, hash);
            if (!isPasswordValid) return res.status(401).json({ error: 'Invalid email or password' });

            // Determine staff status from role or boolean flags
            const isStaff = (String(user.role || '').toLowerCase() === 'staff')
                || (String(user.role || '').toLowerCase() === 'admin')
                || !!(user.is_staff || user.isStaff || user.staff);
            if (!isStaff) return res.status(403).json({ error: 'Forbidden: staff only' });

            // Create session if available; persist minimal user payload
            if (req.session) {
                req.session.user = { id: user.id, email: user.email, role: user.role, is_staff: true };
                req.session.save(err => {
                    if (err) {
                        console.error('Session save error:', err);
                        return res.status(500).json({ error: 'Failed to create session' });
                    }
                    // Strip sensitive fields before responding
                    const { password_hash: _ph, password: _p, ...safe } = user;
                    res.json({ user: safe });
                });
            } else {
                // No session support; return safe user object
                const { password_hash: _ph, password: _p, ...safe } = user;
                res.json({ user: safe });
            }
        } catch (err) {
            console.error('Error logging in staff:', err);
            res.status(500).json({ error: 'Failed to login user' });
        }
    });


    // GET /staff/all
    // Staff-only: returns all orders with their items and owner (user or null for guest)
    router.get('/all', isStaffMiddleware, async (req, res) => {
        try {
            // Load orders (most recent first)
            const orders = await knex('orders').select('*').orderBy('id', 'desc');

            // Load minimal user info once and map by id for cheap lookups
            const users = await knex('users').select('id', 'name', 'email', 'phone');
            const usersById = {};
            users.forEach(u => {
                if (u.id == null) return;
                usersById[String(u.id)] = { id: u.id, name: u.name, email: u.email, phone: u.phone };
            });

            // Load all order_items for these orders in a single query
            const orderIds = orders.map(o => o.id).filter(id => id != null);
            const allItems = orderIds.length ? await knex('order_items').whereIn('order_id', orderIds).select('*') : [];

            // Load referenced menu items to attach names to items
            const menuItemIds = Array.from(new Set(allItems.map(it => it.menu_item_id).filter(id => id != null)));
            const menuItems = menuItemIds.length ? await knex('menu_items').whereIn('id', menuItemIds).select('id', 'name') : [];
            const menuById = {};
            menuItems.forEach(m => { menuById[String(m.id)] = { id: m.id, name: m.name }; });

            // Group items by order and enrich each with menu_item_name
            const itemsByOrder = {};
            allItems.forEach(it => {
                const enriched = { ...it, menu_item_name: menuById[String(it.menu_item_id)]?.name ?? null };
                (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push(enriched);
            });

            // Compose final orders array attaching items and owner info
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

    // POST /staff/addComment/:orderId
    // Add or replace a staff comment (staff_note) on an order
    router.post('/addComment/:orderId', isStaffMiddleware, async (req, res) => {
        const { orderId } = req.params;
        const { comment } = req.body;

        if (!comment || typeof comment !== 'string' || comment.trim() === '') {
            return res.status(400).json({ error: 'Comment is required and must be a non-empty string' });
        }

        try {
            const order = await knex('orders').where({ id: orderId }).first();
            if (!order) return res.status(404).json({ error: 'Order not found' });

            await knex('orders').where({ id: orderId }).update({ staff_note: comment.trim() });
            return res.json({ message: 'Comment added successfully' });
        } catch (err) {
            console.error('Error adding comment to order:', err);
            return res.status(500).json({ error: 'Failed to add comment to order' });
        }
    });

    // POST /staff/lock-order/:orderId
    // Mark an order as locked and move its status to in_kitchen
    router.post('/lock-order/:orderId', isStaffMiddleware, async (req, res) => {
        const { orderId } = req.params;

        try {
            const order = await knex('orders').where({ id: orderId }).first();
            if (!order) return res.status(404).json({ error: 'Order not found' });

            await knex('orders').where({ id: orderId }).update({ locked: true, status: 'in_kitchen' });
            return res.json({ message: 'Order locked successfully' });
        } catch (err) {
            console.error('Error locking order:', err);
            return res.status(500).json({ error: 'Failed to lock order' });
        }
    });

    // PATCH /staff/status/:id
    // Update order status; when moved to 'completed' schedule removal after a delay if it remains completed
    router.patch('/status/:id', isStaffMiddleware, async (req, res) => {
        const orderId = Number(req.params.id);
        const { status } = req.body || {};

        if (!orderId || Number.isNaN(orderId)) return res.status(400).json({ error: 'Invalid order id' });

        const validStatuses = ['pending', 'in_kitchen', 'ready', 'completed', 'cancelled'];
        if (typeof status !== 'string' || !validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        try {
            // Update and return the updated order (adapter may return different shapes)
            const updated = await knex('orders').where('id', orderId).update({ status }).returning('*');
            const updatedOrder = Array.isArray(updated) ? updated[0] : updated;
            if (!updatedOrder) return res.status(404).json({ error: 'Order not found' });

            // When completed, schedule removal after a delay (checks current status before deleting)
            if (status === 'completed') {
                setTimeout(async () => {
                    try {
                        const current = await knex('orders').where({ id: orderId }).first();
                        if (!current) {
                            console.log(`Order ${orderId} already removed before scheduled deletion.`);
                            return;
                        }
                        if (current.status !== 'completed') {
                            console.log(`Order ${orderId} status changed to ${current.status}; skipping deletion.`);
                            return;
                        }

                        // Delete items and order atomically
                        await knex.transaction(async trx => {
                            await trx('order_items').where({ order_id: orderId }).del();
                            await trx('orders').where({ id: orderId }).del();
                        });

                        console.log(`Order ${orderId} and its items removed after completion.`);
                    } catch (err) {
                        console.error(`Error removing completed order ${orderId}:`, err);
                    }
                }, 60000); // delay in milliseconds (60s)
            }

            return res.status(200).json({ order: updatedOrder });
        } catch (err) {
            console.error('Error updating order status:', err);
            return res.status(500).json({ error: 'Failed to update order status' });
        }
    });

    return router;
};
