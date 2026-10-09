/**
 * interruptorPorPerfil.test.js — Issue #725
 *
 * A direção usa a IA sem ninguém autorizar: para quem decide pela escola
 * (diretor e admin), escola sem decisão registrada conta como ligada. O
 * `false` gravado pela escola continua valendo para todos — é assim que a
 * direção desliga —, e professor e secretaria seguem o padrão da rede.
 *
 * Sem banco: o modelo `Escola` devolve a decisão de um mapa em memória.
 */
let mockDecisoes = {};
jest.mock('../models/Escola', () => ({
    findById: (id) => ({
        select: () => ({
            lean: async () => (id in mockDecisoes ? { iaHabilitada: mockDecisoes[id] } : {}),
        }),
    }),
}));

const { iaLiberada, limparCache } = require('../services/ia/interruptor');

let padraoAnterior;
beforeAll(() => {
    padraoAnterior = process.env.IA_ESCOLAS_PADRAO;
});
afterAll(() => {
    process.env.IA_ESCOLAS_PADRAO = padraoAnterior;
    limparCache();
});
beforeEach(() => {
    limparCache();
    mockDecisoes = {};
    // O padrão da rede em produção: escola sem decisão fica desligada.
    process.env.IA_ESCOLAS_PADRAO = 'desligada';
});

it('escola sem decisão: direção e admin usam; professor e secretaria não', async () => {
    expect(await iaLiberada('e1', 'diretor')).toBe(true);
    expect(await iaLiberada('e1', 'admin')).toBe(true);
    expect(await iaLiberada('e1', 'professor')).toBe(false);
    expect(await iaLiberada('e1', 'secretaria')).toBe(false);
    expect(await iaLiberada('e1')).toBe(false);
});

it('o false gravado pela escola vale também para a direção', async () => {
    mockDecisoes.e2 = false;
    expect(await iaLiberada('e2', 'diretor')).toBe(false);
    expect(await iaLiberada('e2', 'professor')).toBe(false);
});

it('o true gravado pela escola libera a equipe', async () => {
    mockDecisoes.e3 = true;
    expect(await iaLiberada('e3', 'professor')).toBe(true);
    expect(await iaLiberada('e3', 'secretaria')).toBe(true);
});

it('padrão da rede ligado continua valendo para a equipe', async () => {
    process.env.IA_ESCOLAS_PADRAO = 'ligada';
    expect(await iaLiberada('e4', 'professor')).toBe(true);
});

it('o cache guarda a decisão da escola, não o resultado do primeiro perfil', async () => {
    expect(await iaLiberada('e5', 'diretor')).toBe(true);
    expect(await iaLiberada('e5', 'professor')).toBe(false);
});

it('sem escola resolvida: quem decide usa, os demais seguem a rede', async () => {
    expect(await iaLiberada(null, 'admin')).toBe(true);
    expect(await iaLiberada(null, 'professor')).toBe(false);
});
