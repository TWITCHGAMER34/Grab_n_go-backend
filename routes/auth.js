const express = require('express');
const { hashPassword, verifyPassword } = require('../utils/password');

module.exports = function (knex) {
    const router = express.Router();

    // POST /auth/register
    router.post('/register', async (req, res) => {
        const { name, email, password, phone } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }

        try {
            const existingUser = await knex('users').where({ email }).first();
            if (existingUser) {
                return res.status(409).json({ error: 'Email already in use' });
            }

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

            const [userId] = await knex('users').insert(newUser).returning('id');
            res.status(201).json({ id: userId, name, email, phone });
        } catch (err) {
            console.error('Error registering user:', err);
            res.status(500).json({ error: 'Failed to register user' });
        }
    });

    // POST /auth/login
    router.post('/login', async (req, res) => {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        try {
            const user = await knex('users').where({ email }).first();
            if (!user) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }

            const isPasswordValid = verifyPassword(password, user.password_hash);
            if (!isPasswordValid) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }

            // set session (cookie maxAge configured in middleware)
            req.session.user = { id: user.id, email: user.email, role: user.role };
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

    // POST /auth/logout
    router.post('/logout', (req, res) => {
        req.session.destroy(err => {
            if (err) return res.status(500).json({ error: 'Failed to logout' });

            res.clearCookie('connect.sid');
            res.json({ ok: true });
        });
    });

    return router;
};