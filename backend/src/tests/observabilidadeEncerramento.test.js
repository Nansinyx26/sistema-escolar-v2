/**
 * observabilidadeEncerramento.test.js — Issue #129
 *
 * O comentário do módulo afirmava que "o comportamento padrão do Node segue
 * valendo" depois de registrar listener em `uncaughtException` e
 * `unhandledRejection`. É o oposto: registrar listener nesses dois eventos
 * SUBSTITUI o padrão. Com a observabilidade ligada, uma exceção entre
 * `observability.init()` (primeira linha do processo) e os handlers do
 * `index.js` (depois do `app.listen`) era reportada e ENGOLIDA — e o boot
 * seguia a partir de um passo que falhou.
 *
 * Estes testes travam o contrato do repasse: armada até `assumirEncerramento()`,
 * só relatório depois.
 */
jest.mock('../observability/config', () => ({
    disabled: false,
    env: 'test',
    release: 'test',
    serviceName: 'teste',
    activeProviders: () => ['sentry'],
    otel: { enabled: false },
    sentry: { enabled: true },
    datadog: { enabled: false },
    newrelic: { enabled: false },
}));
jest.mock('../observability/otel', () => ({
    start: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),
    withSpan: jest.fn(),
    annotate: jest.fn(),
    currentTraceId: jest.fn(),
}));
jest.mock('../observability/providers', () => ({
    startAll: jest.fn(),
    captureException: jest.fn(),
    captureMessage: jest.fn(),
    setUser: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),
    ativos: () => [],
}));

describe('handlers de processo da observabilidade (Issue #129)', () => {
    // `jest.resetModules()` recria também os mocks, então tanto o módulo sob
    // teste quanto o dublê precisam ser requeridos DEPOIS do reset — senão a
    // asserção olha para uma instância que ninguém chamou.
    let obs;
    let providers;
    let handlers;
    let sair;
    let stderr;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();

        handlers = {};
        jest.spyOn(process, 'on').mockImplementation((evento, fn) => {
            if (!handlers[evento]) handlers[evento] = [];
            handlers[evento].push(fn);
            return process;
        });
        sair = jest.spyOn(process, 'exit').mockImplementation(() => {});
        stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

        providers = require('../observability/providers');
        obs = require('../observability');
        obs.init();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('registra listener nos dois eventos — é o que suprime o padrão do Node', () => {
        expect(handlers.uncaughtException).toHaveLength(1);
        expect(handlers.unhandledRejection).toHaveLength(1);
    });

    test('durante o boot uma exceção é reportada E encerra — não é engolida', () => {
        const err = new Error('falha no meio do boot');

        handlers.uncaughtException[0](err);

        expect(providers.captureException).toHaveBeenCalledWith(err, {
            tipo: 'uncaughtException',
        });
        expect(sair).toHaveBeenCalledWith(1);
        expect(stderr).toHaveBeenCalledWith(expect.stringContaining('uncaughtException'));
    });

    test('rejeição não tratada durante o boot também encerra', () => {
        handlers.unhandledRejection[0]('motivo em string');

        expect(providers.captureException).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'motivo em string' }),
            { tipo: 'unhandledRejection' }
        );
        expect(sair).toHaveBeenCalledWith(1);
    });

    test('depois de assumirEncerramento() a observabilidade só reporta', () => {
        obs.assumirEncerramento();
        const err = new Error('depois do listen');

        handlers.uncaughtException[0](err);
        handlers.unhandledRejection[0](err);

        expect(providers.captureException).toHaveBeenCalledTimes(2);
        expect(sair).not.toHaveBeenCalled(); // quem decide agora é o index.js
    });

    test('com a observabilidade desligada nenhum handler é registrado', () => {
        jest.resetModules();
        jest.doMock('../observability/config', () => ({
            disabled: true,
            env: 'test',
            release: 'test',
            serviceName: 'teste',
            activeProviders: () => [],
            otel: { enabled: false },
            sentry: { enabled: false },
            datadog: { enabled: false },
            newrelic: { enabled: false },
        }));
        handlers = {};

        require('../observability').init();

        expect(handlers.uncaughtException).toBeUndefined();
        expect(handlers.unhandledRejection).toBeUndefined();
    });
});
