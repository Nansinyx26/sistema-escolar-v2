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
 */
module.exports = {
    overrides: [
        {
            test: /[\\/]js[\\/]ia[\\/].*\.js$/,
            presets: [
                ['@babel/preset-env', { targets: { node: 'current' } }]
            ]
        }
    ]
};
