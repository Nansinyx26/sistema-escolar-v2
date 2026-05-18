/**
 * globalTeardown.js
 * Executado UMA VEZ depois de todas as suites.
 * Derruba o MongoDB in-memory.
 */
module.exports = async function () {
    if (global.__MONGOD__) {
        await global.__MONGOD__.stop();
    }
};
