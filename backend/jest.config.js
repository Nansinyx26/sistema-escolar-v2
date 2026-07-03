/** jest.config.js — configuração do Jest para o backend */
module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/src/tests/**/*.test.js'],
    globalSetup: './src/tests/globalSetup.js',
    globalTeardown: './src/tests/globalTeardown.js',
        testTimeout: 30000,
    verbose: true,
    coverageDirectory: './coverage',
    collectCoverageFrom: [
        'src/controllers/**/*.js',
        'src/middleware/**/*.js',
        '!src/controllers/MigrationController.js'
    ],
    coverageThreshold: {
        global: { lines: 50 }
    }
};

