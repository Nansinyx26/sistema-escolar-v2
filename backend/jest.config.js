/** jest.config.js — configuração do Jest para o backend */
module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/src/tests/**/*.test.js'],
    globalSetup: './src/tests/globalSetup.js',
    globalTeardown: './src/tests/globalTeardown.js',
    testTimeout: 30000,
    verbose: true,

    // `sanitize-html` 2.17.7 (correção do GHSA-g8qq-57p8-ggw5) passou a depender
    // de `htmlparser2@12`, que é ESM puro — assim como toda a sua árvore
    // (`domhandler`, `domutils`, `dom-serializer`, `domelementtype`, `entities`).
    // Em produção isso não é problema: o Node resolve `require()` de ESM
    // nativamente. O Jest 29 mantém o próprio registro CommonJS e não resolve —
    // quebrava com "Cannot use import statement outside a module" em TODA suíte
    // que carrega `src/utils/sanitize.js`.
    //
    // A exceção abaixo tira esses seis pacotes do `transformIgnorePatterns` para
    // que o babel-jest os converta em CommonJS (ver o override correspondente em
    // `babel.config.js`). Nenhum arquivo do backend passa a ser transformado.
    // O segundo padrão é o default do Jest, repetido aqui porque a opção
    // substitui a lista inteira em vez de acrescentar.
    transformIgnorePatterns: [
        '/node_modules/(?!(htmlparser2|domhandler|domutils|dom-serializer|domelementtype|entities)/)',
        '\\.pnp\\.[^\\\\]+$',
    ],
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
