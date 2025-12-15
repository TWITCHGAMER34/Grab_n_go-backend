// javascript
/**
 * Authentication routes for user registration, login, session inspection, and logout.
 *
 * @module routes/auth
 * @param {Object} knex - Knex query builder instance used to access the `users` table.
 *
 * Exposes:
 * - POST /auth/register  - create a new user (hashes password, checks for duplicate email)
 * - POST /auth/login     - validate credentials and create an express-session
 * - GET  /auth/user      - return current session user (or null)
 * - GET  /auth/check-session - simple loggedIn boolean + user when present
 * - POST /auth/logout    - destroy the current session and clear cookie
 */
const express = require('express');
const { hashPassword, verifyPassword } = require('../utils/password');

module.exports = function (knex) {
    const router = express.Router();

    // POST /auth/register
    router.post('/register', async (req, res) => {
        // Validate required fields
        const { name, email, password, phone } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }

        try {
            // Ensure email is not already registered
            const existingUser = await knex('users').where({ email }).first();
            if (existingUser) {
                return res.status(409).json({ error: 'Email already in use' });
            }

            // Hash the plain-text password before storing
            const password_hash = hashPassword(password);
            const newUser = {
                name,
                email,
                password_hash,
                phone,
                role: 'customer',
                is_active: true,
                created_at: new Date(),
                updated_at: new Date()
            };

            // Insert new user and return created id
            const [userId] = await knex('users').insert(newUser).returning('id');
            res.status(201).json({ id: userId, name, email, phone });
        } catch (err) {
            console.error('Error registering user:', err);
            res.status(500).json({ error: 'Failed to register user' });
        }
    });

    // POST /auth/login
    router.post('/login', async (req, res) => {
        // Basic input validation
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        try {
            // Lookup user by email
            const user = await knex('users').where({ email }).first();
            if (!user) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }

            // Verify provided password against stored hash
            const isPasswordValid = verifyPassword(password, user.password_hash);
            if (!isPasswordValid) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }

            // Create session payload (store minimal, re-fetch full user from DB in middleware when needed)
            req.session.user = { id: user.id, email: user.email, role: user.role };

            // Persist session and respond once saved
            req.session.save(err => {
                if (err) {
                    console.error('Session save error:', err);
                    return res.status(500).json({ error: 'Failed to create session' });
                }
                res.json({ id: user.id, email: user.email, role: user.role });
            });
        } catch (err) {
            console.error('Error logging in user:', err);
            res.status(500).json({ error: 'Failed to login user' });
        }
    });

    // GET /auth/user
    router.get('/user', (req, res) => {
        // Return null when no session exists; otherwise return the stored session user
        if (!req.session) {
            return res.status(200).json({ user: null });
        }
        return res.status(200).json({ user: req.session.user ?? null });
    });

    // GET /auth/check-session
    router.get('/check-session', (req, res) => {
        // Simple boolean check plus user payload when logged in
        if (req.session.user) {
            res.json({ loggedIn: true, user: req.session.user });
        } else {
            res.json({ loggedIn: false });
        }
    });

    // POST /auth/logout
    router.post('/logout', (req, res) => {
        // Destroy the session on the server and clear the session cookie on the client
        req.session.destroy(err => {
            if (err) return res.status(500).json({ error: 'Failed to logout' });

            res.clearCookie('connect.sid');
            res.json({ ok: true });
        });
    });

    return router;
};
