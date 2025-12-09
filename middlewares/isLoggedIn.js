// javascript
module.exports = function (knex, opts = {}) {

    const normalizePhone = (p) => {
        if (p === undefined || p === null) return null;
        const s = String(p).replace(/\D+/g, '');
        return s.length ? s : null;
    };

    return async function isLoggedIn(req, res, next) {
        try {
            if (!req || !req.session) {
                return res.status(401).json({error: 'Unauthorized'});
            }

            let userId = null;
            if (req.session.user && (req.session.user.id)) {
                userId = Number(req.session.user.id);
            }

            if (!userId || Number.isNaN(userId)) {
                return res.status(401).json({error: 'Unauthorized'});
            }

            const userRow = await knex('users')
                .where('id', userId)
                .first('id', 'name', 'email', 'phone', 'role');

            if (!userRow) {
                return res.status(401).json({error: 'Unauthorized'});
            }

            const phoneRaw = userRow.phone;
            const isStaff = Boolean((userRow.role && String(userRow.role).toLowerCase() === 'staff'));

            req.user = {
                id: userRow.id,
                name: userRow.name,
                email: userRow.email ? String(userRow.email).toLowerCase() : null,
                phone: normalizePhone(phoneRaw),
                is_staff: isStaff,
                raw: userRow
            };

            return next();
        } catch (err) {
            console.error('isLoggedIn middleware error:', err);
            return res.status(500).json({error: 'Failed to authenticate session'});
        }
    };
};
