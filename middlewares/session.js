/**
 * Create and return an Express session middleware backed by a SQLite store.
 *
 * @param {Object} [options={}] - Configuration overrides.
 * @param {string} [options.dir] - Directory path where the SQLite DB file will be stored.
 * @param {string} [options.db] - SQLite database filename (default: "sessions.sqlite").
 * @param {string} [options.table] - Table name used by the store (default: "sessions").
 * @param {string} [options.secret] - Session secret (falls back to process.env.SESSION_SECRET).
 * @param {boolean} [options.resave=false] - Express-session resave option.
 * @param {boolean} [options.saveUninitialized=false] - Express-session saveUninitialized option.
 * @param {Object} [options.cookie] - Cookie configuration (e.g., { maxAge: ... }).
 * @returns {Function} Configured express-session middleware instance.
 */
const fs = require('fs'); // file system utilities for ensuring DB directory exists
const path = require('path'); // path helpers
const session = require('express-session'); // express-session factory
const SQLiteStoreFactory = require('connect-sqlite3'); // returns a store factory when passed session

module.exports = function createSessionMiddleware(options = {}) {
    // Bind the SQLite store factory to the express-session instance
    const storeSession = SQLiteStoreFactory(session);

    // Determine directory for DB files; default to project-level db folder
    const dbDir = options.dir || path.join(__dirname, '..', 'db');

    // Ensure the DB directory exists so the store can write the SQLite file
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    // Instantiate the session store with provided or default settings
    const store = new storeSession({
        db: options.db || 'sessions.sqlite',
        dir: dbDir,
        table: options.table || 'sessions',
    });

    // Return a configured express-session middleware instance
    return session({
        store,
        secret: options.secret || process.env.SESSION_SECRET || 'keyboard cat',
        // sensible defaults: don't resave unchanged sessions and don't save empty sessions
        resave: options.resave ?? false,
        saveUninitialized: options.saveUninitialized ?? false,
        // default cookie lifetime: 1 hour (can be overridden via options.cookie)
        cookie: options.cookie || { maxAge: 60 * 60 * 1000 } // 1 hour
    });
};
