// javascript
const path = require('path');

module.exports = {
    development: {
        client: 'better-sqlite3',
        connection: {
            filename: path.resolve(__dirname, './db/dev.sqlite3')
        },
        useNullAsDefault: true,
        migrations: {
            directory: path.resolve(__dirname, './db/migrations')
        },
        seeds: {
            directory: path.resolve(__dirname, './db/seeds')
        },
        pool: {
            afterCreate: (conn, done) => {
                // enable foreign keys for SQLite
                conn.pragma('foreign_keys = ON');
                done(null, conn);
            }
        }
    }
};
