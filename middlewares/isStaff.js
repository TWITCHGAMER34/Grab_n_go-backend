// javascript
// `middlewares/isStaff.js`
module.exports = {
    isStaffMiddleware: function (req, res, next) {
        const sessionUser = req.session && (req.session.user);
        const user = req.user || sessionUser || null;

        if (!user || typeof user === 'number' || typeof user === 'string') {
            return res.status(401).json({ message: 'Authentication required' });
        }

        const role = user.role;
        const isStaff = role === 'staff';

        if (!isStaff) {
            return res.status(403).json({ message: 'Forbidden: staff only' });
        }

        req.user = req.user || sessionUser || user;
        next();
    }
};
