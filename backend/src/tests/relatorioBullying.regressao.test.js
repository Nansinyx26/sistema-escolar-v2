/**
 * relatorioBullying.regressao.test.js — Issue #512
 *
 * Relatório bimestral de intimidação sistemática (Lei 13.185/2015, art. 6º):
 * só bullying e ciberbullying da escola e do bimestre pedidos, contagem sem
 * identificador, supressão k = 5 e acesso só da gestão.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const AuditLog = require('../models/AuditLog');
const ModeracaoOcorrencia = require('../models/ModeracaoOcorrencia');
const { periodoDoBimestre, bimestreDe } = require('../services/conformidade/relatorioBullying');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

const RELATO = 'Relato fixture sobre a Joana Fixture na sala.';

let escolaA;
let escolaB;

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

function equipe(perfil, escola = escolaA) {
    return criarUsuario({
        email: `${perfil}${Math.random()}@escola.test`,
        perfil,
        escolaId: String(escola._id),
    });
}

/** Cria `n` denúncias iguais, direto no banco. */
async function denuncias(n, { categoria = 'bullying', escola = escolaA, em, status = 'pendente' }) {
    const docs = Array.from({ length: n }, () => ({
        escolaId: String(escola._id),
        tipoConteudo: 'texto',
        camada: 'denuncia',
        severidade: 'moderada',
        decisaoAutomatica: 'em_revisao',
        statusAtual: status,
        categoriaDenuncia: categoria,
        relato: RELATO,
        remetenteId: 'remetente-fixture',
        criadoEm: em,
    }));
    await ModeracaoOcorrencia.insertMany(docs);
}

function relatorio(quem, query = 'ano=2026&bimestre=2') {
    return request(app)
        .get(`/api/conformidade/bullying/relatorio?${query}`)
        .set('Cookie', cookieDe(quem));
}

// 3º mês do ano, dentro do 2º bimestre (mar–abr).
const MARCO = new Date('2026-03-15T12:00:00-03:00');

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    escolaA = await Escola.create({ nome: 'EMEF A', tipo: 'EMEF', ativo: true });
    escolaB = await Escola.create({ nome: 'EMEF B', tipo: 'EMEF', ativo: true });
    invalidarCacheEscolas();
});

describe('período', () => {
    it('bimestre civil no fuso de Brasília, meio-aberto', () => {
        const { inicio, fim } = periodoDoBimestre(2026, 2);
        expect(inicio.toISOString()).toBe('2026-03-01T03:00:00.000Z');
        expect(fim.toISOString()).toBe('2026-05-01T03:00:00.000Z');
        expect(periodoDoBimestre(2026, 6).fim.toISOString()).toBe('2027-01-01T03:00:00.000Z');
    });

    it('meia-noite de 1º de março em Brasília já é o 2º bimestre', () => {
        expect(bimestreDe(new Date('2026-03-01T03:00:00Z'))).toEqual({ ano: 2026, bimestre: 2 });
        expect(bimestreDe(new Date('2026-03-01T02:59:59Z'))).toEqual({ ano: 2026, bimestre: 1 });
    });
});

describe('conteúdo', () => {
    it('conta só bullying e ciberbullying da escola e do bimestre, sem identificador', async () => {
        await denuncias(6, { categoria: 'bullying', em: MARCO });
        await denuncias(5, { categoria: 'ciberbullying', em: MARCO, status: 'mantida' });
        // Fora do recorte: outra categoria, outra escola, outro bimestre.
        await denuncias(7, { categoria: 'violencia', em: MARCO });
        await denuncias(7, { escola: escolaB, em: MARCO });
        await denuncias(7, { em: new Date('2026-05-02T12:00:00-03:00') });

        const res = await relatorio(await equipe('secretaria'));

        expect(res.status).toBe(200);
        const d = res.body.data;
        expect(d.total).toBe(11);
        expect(d.totalAbaixoDoLimiar).toBe(false);
        expect(d.porCategoria.map((i) => i.valor).sort()).toEqual([5, 6]);
        expect(d.porSituacao).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ chave: 'Em apuração', valor: 6 }),
                expect.objectContaining({ chave: 'Apuração concluída', valor: 5 }),
            ])
        );

        const corpo = JSON.stringify(res.body);
        expect(corpo).not.toContain('Joana');
        expect(corpo).not.toContain('remetente');
        expect(corpo).not.toMatch(/"_id"|"id"/);
    });

    it('total abaixo de 5 não é publicado como número', async () => {
        await denuncias(3, { em: MARCO });
        const d = (await relatorio(await equipe('diretor'))).body.data;
        expect(d.total).toBeNull();
        expect(d.totalAbaixoDoLimiar).toBe(true);
        expect(d.porCategoria).toEqual([]);
        expect(d.porSituacao).toEqual([]);
    });

    it('célula pequena vai para "Outros" e não volta por subtração do total', async () => {
        await denuncias(9, { categoria: 'bullying', em: MARCO });
        await denuncias(2, { categoria: 'ciberbullying', em: MARCO });
        const d = (await relatorio(await equipe('secretaria'))).body.data;

        expect(d.total).toBe(11);
        // Nenhuma célula publicada entre 1 e 4, nem por diferença do total.
        for (const item of d.porCategoria) expect(item.valor).toBeGreaterThanOrEqual(5);
        const publicadas = d.porCategoria.filter((i) => !i.agregado);
        for (const item of publicadas) {
            const resto = d.total - item.valor;
            expect(resto === 0 || resto >= 5).toBe(true);
        }
    });

    it('bimestre sem denúncia devolve zero', async () => {
        const d = (await relatorio(await equipe('secretaria'))).body.data;
        expect(d.total).toBe(0);
        expect(d.totalAbaixoDoLimiar).toBe(false);
    });

    it('registra a extração no AuditLog', async () => {
        await relatorio(await equipe('secretaria'));
        expect(await AuditLog.countDocuments({ acao: 'EXPORTAR_RELATORIO_BULLYING' })).toBe(1);
    });
});

describe('acesso e validação', () => {
    it('professor e responsável recebem 403', async () => {
        for (const perfil of ['professor', 'responsavel']) {
            const res = await relatorio(await equipe(perfil));
            expect({ perfil, status: res.status }).toEqual({ perfil, status: 403 });
        }
    });

    it('recusa bimestre fora de 1..6 e ano inválido', async () => {
        const sec = await equipe('secretaria');
        expect((await relatorio(sec, 'ano=2026&bimestre=7')).status).toBe(400);
        expect((await relatorio(sec, 'ano=2026&bimestre=0')).status).toBe(400);
        expect((await relatorio(sec, 'ano=abc&bimestre=1')).status).toBe(400);
    });
});
