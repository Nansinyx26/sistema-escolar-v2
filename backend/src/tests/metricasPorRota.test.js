/**
 * metricasPorRota.test.js — estatística por rota do painel de saúde.
 *
 * A média geral esconde o caso que importa: 2% de erro no total pode ser 100%
 * no lançamento de frequência e 0% no resto. Quem opera a escola precisa saber
 * QUAL tela está quebrada, não que "algo" está — e é isso que estes números
 * respondem (Issue #17).
 *
 * O teto de cardinalidade tem teste próprio porque a falha dele é silenciosa e
 * cara: sem limite, um cliente pedindo caminhos aleatórios enche a memória do
 * processo, e o painel de saúde vira o próprio problema de saúde.
 */

const monitoring = require('../services/MonitoringService');

describe('métricas por rota', () => {
    beforeEach(() => {
        monitoring.rotas.clear();
    });

    afterAll(() => {
        monitoring.rotas.clear();
    });

    test('acumula requisições, erros e latência por rota', () => {
        monitoring.registrarRota('GET /api/alunos', 200, 100);
        monitoring.registrarRota('GET /api/alunos', 200, 200);
        monitoring.registrarRota('GET /api/alunos', 500, 300);

        const [r] = monitoring.metricasPorRota();

        expect(r.rota).toBe('GET /api/alunos');
        expect(r.requisicoes).toBe(3);
        expect(r.erros).toBe(1);
        expect(r.mediaMs).toBe(200);
        expect(r.maxMs).toBe(300);
        expect(r.taxaErro).toBeCloseTo(1 / 3);
        expect(r.disponibilidade).toBeCloseTo(2 / 3);
    });

    test('trata 4xx como erro, não só 5xx', () => {
        // Um endpoint respondendo 403 para todo mundo está quebrado do ponto de
        // vista de quem usa, mesmo sendo "erro do cliente" no protocolo.
        monitoring.registrarRota('POST /api/notas', 403, 10);

        const [r] = monitoring.metricasPorRota();
        expect(r.erros).toBe(1);
        expect(r.taxaErro).toBe(1);
    });

    test('ordena por taxa de erro, com latência como desempate', () => {
        monitoring.registrarRota('GET /api/saudavel', 200, 50);
        monitoring.registrarRota('GET /api/lenta', 200, 900);
        monitoring.registrarRota('GET /api/quebrada', 500, 20);

        const rotas = monitoring.metricasPorRota().map((r) => r.rota);

        // Quem abre o painel quer o que está quebrado no topo, não o que tem
        // mais tráfego.
        expect(rotas[0]).toBe('GET /api/quebrada');
        expect(rotas[1]).toBe('GET /api/lenta');
        expect(rotas[2]).toBe('GET /api/saudavel');
    });

    test('respeita o teto de cardinalidade', () => {
        const teto = monitoring.MAX_ROTAS;

        for (let i = 0; i < teto + 50; i++) {
            monitoring.registrarRota(`GET /api/rota-${i}`, 200, 10);
        }

        expect(monitoring.rotas.size).toBe(teto);
    });

    test('rota já conhecida continua acumulando depois do teto', () => {
        // O teto só barra rota NOVA. Se barrasse atualização, a métrica da rota
        // mais usada congelaria justamente quando o sistema está sob carga.
        monitoring.registrarRota('GET /api/importante', 200, 10);

        for (let i = 0; i < monitoring.MAX_ROTAS + 10; i++) {
            monitoring.registrarRota(`GET /api/ruido-${i}`, 200, 10);
        }

        monitoring.registrarRota('GET /api/importante', 200, 30);

        const r = monitoring.metricasPorRota().find((x) => x.rota === 'GET /api/importante');
        expect(r.requisicoes).toBe(2);
        expect(r.mediaMs).toBe(20);
    });

    test('recordRequest sem rota não quebra', () => {
        // Assinatura antiga (statusCode, responseTime) continua válida: há
        // chamadas fora do requestLogger, e quebrar uma delas derrubaria a
        // requisição inteira por causa de telemetria.
        expect(() => monitoring.recordRequest(200, 15)).not.toThrow();
        expect(monitoring.rotas.size).toBe(0);
    });

    test('lista vazia quando nada foi registrado', () => {
        expect(monitoring.metricasPorRota()).toEqual([]);
    });
});

describe('ligação entre o middleware e a métrica', () => {
    const request = require('supertest');
    const app = require('../app');

    beforeEach(() => {
        monitoring.rotas.clear();
    });

    afterAll(() => {
        monitoring.rotas.clear();
    });

    test('uma requisição real aparece na estatística por rota', async () => {
        await request(app).get('/api/config');

        const rotas = monitoring.metricasPorRota();

        // O teste de unidade cobre a acumulação; este cobre o FIO — se alguém
        // remover o terceiro argumento de recordRequest no requestLogger, a
        // lógica continua correta e o painel fica vazio para sempre.
        expect(rotas.length).toBeGreaterThan(0);
        expect(rotas.some((r) => r.rota.includes('/api/config'))).toBe(true);
    });

    test('o identificador na URL não vira uma rota nova a cada chamada', async () => {
        await request(app).get('/api/turmas/507f1f77bcf86cd799439011');
        await request(app).get('/api/turmas/610a1f77bcf86cd799439022');

        const comId = monitoring.metricasPorRota().filter((r) => r.rota.includes('/api/turmas'));

        // Sem normalização, dois alunos consultados = duas linhas de uma
        // requisição cada, e a tabela vira lixo em minutos.
        expect(comId.length).toBe(1);
        expect(comId[0].rota).toContain(':id');
        expect(comId[0].requisicoes).toBe(2);
    });
});
