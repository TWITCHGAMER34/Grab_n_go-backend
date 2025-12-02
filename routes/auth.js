const express = require('express');
const {hashPassword} = require('../utils/password'); // Assume a utility function for hashing passwords

module.exports = function (knex) {
    const router = express.Router();

    // POST /auth/register -> register a new user
    router.post('/register', async (req, res) => {
        const {name, email, password, phone} = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({error: 'Name, email, and password are required'});
        }

        try {
            const existingUser = await knex('users').where({email}).first();
            if (existingUser) {
                return res.status(409).json({error: 'Email already in use'});
            }

            const password_hash = hashPassword(password); // Implement password hashing
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
            res.status(201).json({id: userId, name, email, phone});
        } catch (err) {
            console.error('Error registering user:', err);
            res.status(500).json({error: 'Failed to register user'});
        }
    });
    return router;
}