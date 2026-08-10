/**
 * .dependency-cruiser.cjs — contrato de arquitetura do backend.
 *
 * O que isto resolve: a estrutura em camadas do `backend/src` existe hoje por
 * convenção. Nada impede um `model` importar um `controller`, ou uma rota
 * conversar direto com o banco pulando o service. Convenção que ninguém
 * verifica vira convenção que ninguém segue.
 *
 *   routes → controllers → services → models
 *
 * Cada camada só enxerga a de baixo. `utils`, `config` e `validation` são
 * transversais: qualquer camada pode usá-las, e elas não podem usar ninguém.
 *
 *   npm run arch          valida
 *   npm run arch:graph    gera o diagrama em docs/arquitetura.svg
 *
 * Severidades: `error` trava o CI. `warn` aparece no relatório sem travar —
 * usado onde já existe violação legada esperando triagem (ver Issue "Impor o
 * contrato de arquitetura em camadas"). Conforme a dívida for paga, sobe para
 * `error`.
 */

module.exports = {
    forbidden: [
        // ---------------------------------------------------------- camadas

        {
            name: 'model-nao-sobe',
            severity: 'error',
            comment:
                'Model é a camada mais baixa: representa dado, não orquestra nada. ' +
                'Se um model precisa de controller/service/rota, a regra de negócio ' +
                'está no lugar errado.',
            from: { path: '^backend/src/models' },
            to: {
                path: '^backend/src/(controllers|routes|services|middleware)',
            },
        },

        {
            name: 'service-nao-sobe',
            severity: 'error',
            comment:
                'Service não conhece quem o chama. Depender de controller ou rota ' +
                'impede reusar a mesma regra num job, num socket ou num script.',
            from: { path: '^backend/src/services' },
            to: { path: '^backend/src/(controllers|routes)' },
        },

        {
            name: 'controller-nao-importa-rota',
            severity: 'error',
            comment: 'Rota chama controller, nunca o contrário.',
            from: { path: '^backend/src/controllers' },
            to: { path: '^backend/src/routes' },
        },

        {
            name: 'transversal-nao-desce',
            severity: 'warn',
            comment:
                'utils/config/validation são transversais: todo mundo usa, e por ' +
                'isso não podem depender de camada nenhuma — senão viram ciclo.',
            from: { path: '^backend/src/(utils|config|validation)' },
            to: { path: '^backend/src/(controllers|routes|services|models)' },
        },

        {
            name: 'rota-nao-fala-com-banco',
            severity: 'warn',
            comment:
                'Rota que consulta model direto pula a camada de regra de negócio. ' +
                'Existe dívida legada aqui — por isso warn, não error ainda.',
            from: { path: '^backend/src/routes' },
            to: { path: '^backend/src/(models|database)' },
        },

        // ------------------------------------------------------ saúde geral

        {
            name: 'sem-ciclos',
            severity: 'error',
            comment:
                'Dependência circular quebra ordem de inicialização e deixa ' +
                'require devolvendo objeto vazio de forma intermitente.',
            from: {},
            to: { circular: true },
        },

        {
            name: 'sem-orfaos',
            severity: 'warn',
            comment: 'Arquivo que ninguém importa: candidato a remoção (ver Knip).',
            from: {
                orphan: true,
                pathNot: [
                    '(^|/)\\.[^/]+\\.(js|cjs|mjs|json)$',
                    '\\.d\\.ts$',
                    '(^|/)tsconfig\\.json$',
                    '(^|/)(babel|jest|stryker|commitlint)\\.config\\.(js|cjs|mjs|json)$',
                    '^backend/src/index\\.js$',
                    '^backend/migrations/',
                    '^backend/scripts/',
                ],
            },
            to: {},
        },

        {
            name: 'sem-dependencia-fantasma',
            severity: 'error',
            comment:
                'Módulo importado sem estar no package.json. Funciona na máquina de ' +
                'quem escreveu e quebra no deploy.',
            from: {},
            to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
        },

        {
            name: 'sem-dev-em-producao',
            severity: 'error',
            comment: 'devDependency importada por código de produção.',
            from: { pathNot: ['\\.test\\.js$', '^backend/tests/', '^e2e/', '^scripts/'] },
            to: { dependencyTypes: ['npm-dev'] },
        },

        {
            name: 'sem-modulo-depreciado',
            severity: 'warn',
            from: {},
            to: { dependencyTypes: ['deprecated'] },
        },
    ],

    options: {
        doNotFollow: {
            path: ['node_modules'],
        },

        exclude: {
            path: [
                'node_modules',
                'coverage',
                'dist',
                '\\.stryker-tmp',
                'playwright-report',
                'backend/scripts',
                'js/libs',
                'js/legacy',
                '\\.min\\.js$',
            ],
        },

        includeOnly: {
            path: ['^backend/src', '^js/', '^scripts/'],
        },

        tsPreCompilationDeps: true,

        enhancedResolveOptions: {
            exportsFields: ['exports'],
            conditionNames: ['require', 'node', 'import'],
        },

        reporterOptions: {
            dot: {
                collapsePattern: 'node_modules/(@[^/]+/[^/]+|[^/]+)',
                theme: {
                    graph: { rankdir: 'TD', splines: 'ortho' },
                    modules: [
                        { criteria: { source: '^backend/src/routes' },
                          attributes: { fillcolor: '#a5d8ff' } },
                        { criteria: { source: '^backend/src/controllers' },
                          attributes: { fillcolor: '#b2f2bb' } },
                        { criteria: { source: '^backend/src/services' },
                          attributes: { fillcolor: '#ffec99' } },
                        { criteria: { source: '^backend/src/models' },
                          attributes: { fillcolor: '#ffc9c9' } },
                        { criteria: { source: '^backend/src/observability' },
                          attributes: { fillcolor: '#d0bfff' } },
                    ],
                },
            },
            archi: {
                collapsePattern:
                    '^(backend/src/[^/]+|js|scripts)',
            },
        },
    },
};
