/**
 * Express middleware that ensures the current request is authenticated and the user
 * has a `staff` role.
 *
 * @function isStaffMiddleware
 * @param {Object} req - Express request object; expects `req.session.user` or `req.user`.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 *
 * Behavior:
 * - Accepts a user from `req.user` (preferred) or `req.session.user`.
 * - Returns 401 if no valid user is present.
 * - Normalizes the user's `role` to lowercase and checks for `'staff'`.
 * - Returns 403 when user is authenticated but not staff.
 * - Ensures `req.user` is set for downstream handlers.
 */
module.exports = {
    isStaffMiddleware: function (req, res, next) {
        // Try to read the user from an attached req.user (set by auth middleware),
        // fallback to session-based user (e.g., passport or custom session).
        const sessionUser = req.session && req.session.user;
        const user = req.user || sessionUser || null;

        // If there is no user or the user is a primitive (id only), reject as unauthenticated.
        if (!user || typeof user === 'number' || typeof user === 'string') {
            return res.status(401).json({ message: 'Authentication required' });
        }

        // Read role and perform a safe, case-insensitive comparison.
        const role = user.role;
        const isStaff = (role && String(role).toLowerCase() === 'staff');

        // Authenticated but not staff: forbidden.
        if (!isStaff) {
            return res.status(403).json({ message: 'Forbidden: staff only' });
        }

        // Ensure req.user is populated for downstream handlers (prefer existing req.user).
        req.user = req.user || sessionUser || user;

        // User is authenticated and authorized; continue.
        next();
    }
};
