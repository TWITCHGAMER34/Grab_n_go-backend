// javascript
/**
 * Knex configuration for the project environments.
 *
 * - development: uses the `better-sqlite3` client with a local SQLite file.
 * - Enables SQLite foreign key enforcement via `PRAGMA foreign_keys = ON`.
 * - Configures migration and seed directories and sensible defaults for SQLite.
 *
 * Used by `index.js` where the current NODE_ENV selects the appropriate config.
 */
const path = require('path');

module.exports = {
    development: {
        // Use the faster native sqlite3 binding via better-sqlite3
        client: 'better-sqlite3',

        // Points to the SQLite file used for the development DB
        connection: {
            filename: path.resolve(__dirname, './db/dev.sqlite3')
        },

        // SQLite adapters commonly require this when using column defaults
        useNullAsDefault: true,

        // Where to find migration files for schema changes
        migrations: {
            directory: path.resolve(__dirname, './db/migrations')
        },

        // Where to find seed files for populating test/dev data
        seeds: {
            directory: path.resolve(__dirname, './db/seeds')
        },

        // Pool hooks — used here to enable SQLite foreign key enforcement
        pool: {
            afterCreate: (conn, done) => {
                // Ensure foreign key constraints are enforced for each new connection
                conn.pragma('foreign_keys = ON');
                // Signal that the connection setup is complete
                done(null, conn);
            }
        }
    }
};
