const fs = require('fs');
const path = require('path');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');

module.exports = function createSessionMiddleware(options = {}) {
    const storeSession = SQLiteStoreFactory(session);
    const dbDir = options.dir || path.join(__dirname, '..', 'db');

    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    const store = new storeSession({
        db: options.db || 'sessions.sqlite',
        dir: dbDir,
        table: options.table || 'sessions',
    });

    return session({
        store,
        secret: options.secret || process.env.SESSION_SECRET || 'keyboard cat',
        resave: options.resave ?? false,
        saveUninitialized: options.saveUninitialized ?? false,
        cookie: options.cookie || { maxAge: 60 * 60 * 1000 } // 1 hour
    });
};
