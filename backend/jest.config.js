/** jest.config.js — configuração do Jest para o backend */
module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/src/tests/**/*.test.js'],
    globalSetup: './src/tests/globalSetup.js',
    globalTeardown: './src/tests/globalTeardown.js',
    testTimeout: 30000,
    verbose: true,
    coverageDirectory: './coverage',

    // O que entra na medição.
    //
    // Antes só `controllers` e `middleware` eram medidos. `services` (45
    // arquivos), `utils` (28) e `observability` (7) ficavam INVISÍVEIS: o
    // relatório podia mostrar um número saudável enquanto a camada com mais
    // regra de negócio do sistema não tinha teste nenhum — e ninguém saberia.
    //
    // Incluí-los derruba o percentual, e é exatamente esse o ponto: o número
    // passa a dizer a verdade sobre o que está coberto. Ver Issue #6.
    collectCoverageFrom: [
        'src/controllers/**/*.js',
        'src/middleware/**/*.js',
        'src/services/**/*.js',
        'src/utils/**/*.js',
        'src/validation/**/*.js',
        'src/observability/**/*.js',

        // Migração one-shot: roda uma vez, à mão, e sai de cena.
        '!src/controllers/MigrationController.js',
        // Testes e fixtures não se medem a si mesmos.
        '!src/tests/**',
    ],

    // O limiar era 50 e NUNCA foi exercitado: o CI chamava `npm run coverage`,
    // script que não existe, e o `--if-present` fazia o passo passar em
    // silêncio. Na primeira execução real a cobertura medida foi 40,07% —
    // ou seja, o projeto não atingia a própria régua declarada.
    //
    // Com o escopo ampliado o número medido foi 43,84% — mais alto que os
    // 40,07% anteriores, e não porque a cobertura melhorou: `services/ia`
    // (72%) e `utils` (54%) estavam fora da conta e puxaram a média para
    // cima. A medição parcial anterior era pessimista em alguns pontos e
    // cega em outros; nenhum dos dois números descrevia o sistema.
    //
    // Este valor é o PISO honesto de hoje, não a meta. Serve para o número
    // não cair. A meta de 60% em controllers e services segue na Issue #6.
    //
    // Suba junto com os testes; nunca abaixe.
    coverageThreshold: {
        global: { lines: 43 },
    },
};
