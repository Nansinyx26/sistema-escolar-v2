/**
 * iaLigadaPelaDirecao.regressao.test.js — Issue #711
 *
 * A IA nasce desligada em cada escola (#401) e a mensagem do 403 dizia que "a
 * direção pode ligá-la", mas só o admin conseguia. A direção liga a IA da
 * PRÓPRIA escola; a decisão vai ao log com antes e depois; o 403 do copiloto
 * diz à tela quando quem pergunta pode ligar.
 */
const request = require('supertest');

global.__provedorIA = null;

jest.mock('../services/ia/AIProvider', () => {
    const real = jest.requireActual('../services/ia/AIProvider');
    return { ...real, obterProvider: () => global.__provedorIA };
});

const app = require('../app');
const Escola = require('../models/Escola');
const AuditLog = require('../models/AuditLog');
const interruptor = require('../services/ia/interruptor');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    criarUsuario,
    autorizarFerramentas,
} = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

const provedorQueResponde = {
    configurado: () => true,
    async *stream() {
        yield { tipo: 'texto', texto: 'Olá!' };
        yield { tipo: 'fim', motivo: 'completo' };
    },
};

let escola;
let outraEscola;
let diretor;
let prof;
let padraoAnterior;

beforeAll(async () => {
    await conectarBanco();
    padraoAnterior = process.env.IA_ESCOLAS_PADRAO;
});
afterAll(async () => {
    process.env.IA_ESCOLAS_PADRAO = padraoAnterior;
    interruptor.limparCache();
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    // O padrão da rede em produção: escola sem decisão fica desligada.
    process.env.IA_ESCOLAS_PADRAO = 'desligada';
    interruptor.limparCache();
    invalidarCacheEscolas();
    global.__provedorIA = provedorQueResponde;

    escola = await Escola.create({ nome: 'EMEF IA', tipo: 'EMEF', ativo: true });
    outraEscola = await Escola.create({ nome: 'EMEF Outra', tipo: 'EMEF', ativo: true });
    diretor = await criarUsuario({
        email: 'dir.ia@escola.test',
        perfil: 'diretor',
        escolaId: String(escola._id),
    });
    prof = await criarUsuario({
        email: 'prof.ia@escola.test',
        perfil: 'professor',
        escolaId: String(escola._id),
    });
    // O professor tem a ferramenta autorizada pela direção (Issue #727): o que
    // se testa aqui é a chave da ESCOLA.
    await autorizarFerramentas(prof);
});

function ligar(quem, escolaId, habilitada = true) {
    return request(app)
        .patch(`/api/escolas/${escolaId}/ia`)
        .set('Cookie', cookieDe(quem))
        .send({ habilitada });
}

function conversar(quem) {
    return request(app)
        .post('/api/ia/chat')
        .set('Cookie', cookieDe(quem))
        .send({ mensagem: 'Bom dia' });
}

describe('IA desligada: o 403 diz se quem pergunta pode ligar', () => {
    it('para a direção, oferece ligar a escola que o interruptor consultou', async () => {
        const res = await conversar(diretor);
        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('IA_DESLIGADA_NESTA_ESCOLA');
        expect(res.body.podeLigar).toBe(true);
        expect(res.body.escolaId).toBe(String(escola._id));
    });

    it('para o professor, não oferece nada', async () => {
        const res = await conversar(prof);
        expect(res.status).toBe(403);
        expect(res.body.podeLigar).toBe(false);
        expect(res.body.escolaId).toBeUndefined();
    });
});

describe('a direção liga a IA da própria escola', () => {
    it('liga, passa a conversar, e a decisão vai ao log com antes e depois', async () => {
        const res = await ligar(diretor, escola._id);
        expect(res.status).toBe(200);
        expect(res.body.data.iaHabilitada).toBe(true);

        const chat = await conversar(diretor);
        expect(chat.status).toBe(200);
        expect(chat.text).toContain('Olá!');

        const log = await AuditLog.findOne({ acao: 'IA_ESCOLA_ALTERADA' }).lean();
        expect(log.detalhes.valorAnterior).toEqual({ iaHabilitada: null });
        expect(log.detalhes.valorNovo).toEqual({ iaHabilitada: true });
    });

    it('a decisão vale para a equipe da escola', async () => {
        await ligar(diretor, escola._id);
        expect((await conversar(prof)).status).toBe(200);
    });

    it('a direção também desliga', async () => {
        await ligar(diretor, escola._id, true);
        const res = await ligar(diretor, escola._id, false);
        expect(res.status).toBe(200);
        expect((await conversar(diretor)).status).toBe(403);
    });
});

describe('quem não decide', () => {
    it('diretor não liga a IA de outra escola', async () => {
        expect((await ligar(diretor, outraEscola._id)).status).toBe(403);
        expect((await Escola.findById(outraEscola._id).lean()).iaHabilitada).toBeUndefined();
    });

    it('professor e secretaria não ligam', async () => {
        const sec = await criarUsuario({
            email: 'sec.ia@escola.test',
            perfil: 'secretaria',
            escolaId: String(escola._id),
        });
        expect((await ligar(prof, escola._id)).status).toBe(403);
        expect((await ligar(sec, escola._id)).status).toBe(403);
        expect((await Escola.findById(escola._id).lean()).iaHabilitada).toBeUndefined();
    });

    it('recusa corpo sem booleano', async () => {
        const res = await request(app)
            .patch(`/api/escolas/${escola._id}/ia`)
            .set('Cookie', cookieDe(diretor))
            .send({ habilitada: 'sim' });
        expect(res.status).toBe(400);
    });
});
