// javascript
/**
 * Express middleware that verifies an authenticated session and attaches a sanitized
 * user object to `req.user`.
 *
 * @param {Object} knex - Knex query builder instance used to fetch the user row.
 * @param {Object} [opts={}] - Optional settings (reserved for future use).
 * @returns {Function} Express middleware function (req, res, next).
 *
 * Behavior:
 * - Validates presence of `req.session` and a numeric `req.session.user.id`.
 * - Loads user record from the `users` table and returns 401 if absent.
 * - Normalizes phone numbers and lowercases email before setting `req.user`.
 * - On error, logs and responds with 500.
 */
module.exports = function (knex, opts = {}) {

    // Helper to normalize phone values to digits-only string or null.
    const normalizePhone = (p) => {
        if (p === undefined || p === null) return null;
        // Strip non-digit characters
        const s = String(p).replace(/\D+/g, '');
        // Return null for empty result to avoid storing empty strings
        return s.length ? s : null;
    };

    return async function isLoggedIn(req, res, next) {
        try {
            // Ensure session object exists
            if (!req || !req.session) {
                return res.status(401).json({error: 'Unauthorized'});
            }

            // Extract numeric user id from session (defensive: may be string)
            let userId = null;
            if (req.session.user && (req.session.user.id)) {
                userId = Number(req.session.user.id);
            }

            // If missing or invalid id, unauthorized
            if (!userId || Number.isNaN(userId)) {
                return res.status(401).json({error: 'Unauthorized'});
            }

            // Fetch user row with only the needed columns
            const userRow = await knex('users')
                .where('id', userId)
                .first('id', 'name', 'email', 'phone', 'role');

            // If no such user in DB, unauthorized
            if (!userRow) {
                return res.status(401).json({error: 'Unauthorized'});
            }

            // Preserve raw phone value for normalization
            const phoneRaw = userRow.phone;
            // Determine staff flag from role (case-insensitive)
            const isStaff = Boolean((userRow.role && String(userRow.role).toLowerCase() === 'staff'));

            // Attach a sanitized user object to the request for downstream handlers
            req.user = {
                id: userRow.id,
                name: userRow.name,
                // Normalize email to lower-case or null
                email: userRow.email ? String(userRow.email).toLowerCase() : null,
                // Normalize phone to digits-only string or null
                phone: normalizePhone(phoneRaw),
                is_staff: isStaff,
                // Keep raw DB row available if caller needs full details
                raw: userRow
            };

            return next();
        } catch (err) {
            // Log unexpected errors and return a 500 to the client
            console.error('isLoggedIn middleware error:', err);
            return res.status(500).json({error: 'Failed to authenticate session'});
        }
    };
};
