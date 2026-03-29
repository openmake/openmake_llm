const crypto = require('crypto');
module.exports = {
    v4: () => crypto.randomUUID(),
    NIL: '00000000-0000-0000-0000-000000000000',
    validate: () => true,
    version: () => 4
};
