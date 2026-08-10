/**
 * commitlint.config.js — valida a mensagem de commit (AGENTS.md §4).
 *
 * Roda no hook `commit-msg` (husky) e no CI. Commit fora do padrão é rejeitado
 * antes de existir, não depois.
 *
 * Formato:
 *   <tipo>(<escopo>): <descrição no imperativo, minúscula, sem ponto final>
 *
 *   [corpo opcional]
 *
 *   Refs #142
 */

module.exports = {
    extends: ['@commitlint/config-conventional'],

    rules: {
        'type-enum': [
            2,
            'always',
            [
                'feat', // nova função
                'fix', // correção
                'refactor', // reescrita sem mudar comportamento
                'perf', // desempenho
                'docs', // documentação
                'test', // testes
                'build', // build, empacotamento
                'ci', // pipeline
                'chore', // manutenção, dependências
                'style', // formatação, sem efeito em código
                'revert', // reversão
            ],
        ],

        'scope-enum': [
            1, // aviso, não erro: escopo novo não deve travar o commit
            'always',
            [
                'backend',
                'frontend',
                'portal',
                'motion',
                'obs',
                'ci',
                'deps',
                'db',
                'docs',
                'auth',
                'testes',
            ],
        ],

        'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
        'subject-empty': [2, 'never'],
        'subject-full-stop': [2, 'never', '.'],
        'type-empty': [2, 'never'],

        // 100 acomoda escopo + descrição em português sem incentivar romance.
        'header-max-length': [2, 'always', 100],
        'body-max-line-length': [1, 'always', 120],
    },

    /**
     * Commits gerados por ferramenta não seguem o padrão e não devem quebrar
     * o fluxo — merge, revert e o commit inicial.
     */
    ignores: [
        (message) => /^Merge (branch|pull request|remote-tracking)/.test(message),
        (message) => /^Revert /.test(message),
        (message) => /^Initial commit$/.test(message),
    ],

    helpUrl:
        'https://github.com/Nansinyx26/sistema-escolar-v2/blob/main/AGENTS.md#4-commits--conventional-commits-obrigatório',
};
