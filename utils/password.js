const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

function hashPassword(password) {
    return bcrypt.hashSync(password, SALT_ROUNDS);
}

function verifyPassword(password, hash) {
    return bcrypt.compareSync(password, hash);
}

module.exports = {
    hashPassword,
    verifyPassword
};