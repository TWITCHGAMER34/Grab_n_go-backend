/**
 * Routes for menu data: returns menu categories with nested items.
 *
 * @module routes/menu
 * @param {Object} knex - Knex query builder instance for DB access.
 *
 * Exposes:
 * - GET /menu  -> responds with `{ categories: [ { id, name, description, position, items: [...] } ] }`
 *
 * Behavior:
 * - Loads ordered categories and ordered items from separate tables.
 * - Attaches items to their category by matching `category_id`.
 * - Omits large/binary fields (e.g. images) from the API response for performance.
 */
const express = require('express');

module.exports = function (knex) {
    const router = express.Router();

    // GET /menu  -> returns categories with nested items
    router.get('/', async (req, res) => {
        try {
            // Load categories in display order
            const categories = await knex('menu_categories')
                .select('id', 'name', 'description', 'position')
                .orderBy('position', 'asc');

            // Load items and omit any large/binary fields (e.g. image) to keep responses small
            const items = await knex('menu_items')
                .select('id', 'category_id', 'name', 'description', 'available', 'position', 'price')
                .orderBy(['category_id', 'position']);

            // Group items under their category; preserve category ordering
            const result = categories.map(cat => ({
                ...cat,
                // Filter items that belong to this category (matching id -> category_id)
                items: items.filter(it => it.category_id === cat.id)
            }));

            // Respond with the composed categories + nested items structure
            res.json({ categories: result });
        } catch (err) {
            // Log unexpected errors and return a generic 500 message
            console.error('Error fetching menu:', err);
            res.status(500).json({ error: 'Failed to fetch menu' });
        }
    });

    return router;
};
