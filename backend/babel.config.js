/**
 * babel.config.js — usado APENAS pelos testes (via babel-jest).
 *
 * O backend é CommonJS e não precisa de transpilação. O que precisa são os
 * módulos do copiloto em `js/ia/`, que são ES modules de verdade (carregados no
 * browser por `<script type="module">`) e que o Jest, rodando em CommonJS, não
 * conseguiria importar.
 *
 * Por isso o preset fica dentro de um `overrides` restrito a esse caminho:
 * nenhum arquivo do backend passa por transformação, e a suíte existente
 * continua rodando exatamente como antes.
 *
 * O segundo override existe pelo mesmo motivo, do lado das dependências:
 * `sanitize-html` 2.17.7 (correção do GHSA-g8qq-57p8-ggw5) trouxe
 * `htmlparser2@12` e toda a sua árvore como ESM puro. Em produção o Node resolve
 * `require()` de ESM sozinho; o Jest 29 não. Ver a exceção correspondente em
 * `transformIgnorePatterns` no `jest.config.js`.
 */
module.exports = {
    overrides: [
        {
            test: /[\\/]js[\\/]ia[\\/].*\.js$/,
            presets: [
                ['@babel/preset-env', { targets: { node: 'current' } }]
            ]
        },
        {
            test: /[\\/]node_modules[\\/](htmlparser2|domhandler|domutils|dom-serializer|domelementtype|entities)[\\/]/,
            presets: [
                ['@babel/preset-env', { targets: { node: 'current' } }]
            ]
        }
    ]
};
