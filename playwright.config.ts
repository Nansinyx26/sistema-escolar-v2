/**
 * playwright.config.ts — testes end-to-end.
 *
 * O sistema é multipágina (66 HTMLs servidos pelo próprio Express) mais um
 * portal React em Vite. Os testes rodam contra o backend real, que já serve o
 * frontend estático — é o mesmo caminho que o usuário percorre.
 *
 *   npm run test:e2e            roda tudo headless
 *   npm run test:e2e:ui         modo interativo (melhor para escrever teste)
 *   npm run test:e2e -- --debug depura passo a passo
 *
 * Fluxos cobertos em e2e/. Ver AGENTS.md §10.
 */

import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 3001);
const BASE_URL = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}`;
const IS_CI = !!process.env.CI;

export default defineConfig({
    testDir: './e2e',
    outputDir: './test-results',

    // Teste e2e que depende de ordem esconde acoplamento entre casos.
    fullyParallel: true,

    // No CI, `.only` esquecido faria a suíte passar testando quase nada.
    forbidOnly: IS_CI,

    retries: IS_CI ? 2 : 0,
    workers: IS_CI ? 2 : undefined,

    timeout: 30_000,
    expect: { timeout: 10_000 },

    reporter: IS_CI
        ? [
              ['list'],
              ['html', { outputFolder: 'playwright-report', open: 'never' }],
              ['github'],
          ]
        : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],

    use: {
        baseURL: BASE_URL,
        // Artefato só do que falhou: reter tudo enche o storage do CI.
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        actionTimeout: 10_000,
        navigationTimeout: 20_000,
        locale: 'pt-BR',
        timezoneId: 'America/Sao_Paulo',
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
        },
        {
            // A secretaria e os responsáveis usam muito o celular.
            name: 'mobile',
            use: { ...devices['Pixel 7'] },
        },
        {
            // Projeto dedicado: valida que a interface continua utilizável com
            // o movimento desligado (AGENTS.md §8). Sem isso, `prefers-reduced-
            // motion` vira uma linha de CSS que ninguém nunca exercita.
            name: 'reduced-motion',
            use: {
                ...devices['Desktop Chrome'],
                reducedMotion: 'reduce',
            },
            testMatch: /.*\.a11y\.spec\.ts/,
        },
    ],

    // Sobe o backend sozinho; ele já serve o frontend estático.
    // O bootstrap levanta um MongoDB em memória antes — sem banco, o backend
    // chama process.exit(1) e o webServer esperaria para sempre.
    webServer: {
        command: 'node scripts/start-e2e-server.js',
        // Aponta para a landing, não para /api/health: o health devolve 503
        // quando o Mongo não está saudável, e o Playwright ficaria esperando
        // um 2xx que nunca chega. A landing é estática e prova que o Express
        // subiu — que é o que este gate precisa saber.
        url: `${BASE_URL}/`,
        reuseExistingServer: !IS_CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            NODE_ENV: 'test',
            PORT: String(PORT),
            // Observabilidade fica fora do e2e: nada de mandar evento de teste
            // para provedor de produção.
            OBSERVABILITY_DISABLED: 'true',
        },
    },
});
