/**
 * registroPedidoTitular.regressao.test.js — Issue #484
 *
 * Ajustes no registro do pedido do titular, depois da #413:
 *  - o motivo digitado pelo titular não vai para o AuditLog, que só aceita
 *    inclusão — fica no próprio pedido;
 *  - a resposta não atribui à LGPD o prazo de um pedido de exclusão;
 *  - o pedido guarda o identificador da escola, não o nome;
 *  - o protocolo não carrega pedaço do id da conta;
 *  - na fila da administração, busca e escola valem juntas.
 */
const request = require('supertest');
const app = require('../app');
const Aluno = require('../models/Aluno');
const AuditLog = require('../models/AuditLog');
const PedidoTitular = require('../models/PedidoTitular');
const { listarPedidos } = require('../controllers/AdminPedidosTitularController');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

async function pedirExclusao(usuario, motivo) {
    return request(app)
        .post('/api/meus-dados/solicitar-exclusao')
        .set('Cookie', cookieDe(usuario))
        .send(motivo ? { motivo } : {});
}

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
});

describe('o motivo fica no pedido, não no log', () => {
    it('o AuditLog registra protocolo e id, sem o texto livre nem o e-mail na descrição', async () => {
        const mae = await criarUsuario({ email: 'mae.log@escola.test', perfil: 'responsavel' });
        const motivo = 'meu filho faz tratamento e prefiro não expor';

        const res = await pedirExclusao(mae, motivo);
        expect(res.status).toBe(200);

        const pedido = await PedidoTitular.findOne({ protocolo: res.body.protocolo });
        expect(pedido.motivo).toBe(motivo);

        const registro = await AuditLog.findOne({ acao: 'LGPD_SOLICITAR_EXCLUSAO' }).lean();
        const descricao = registro.detalhes.descricao;
        expect(descricao).toContain(res.body.protocolo);
        expect(descricao).toContain(String(mae._id));
        expect(descricao).not.toContain('tratamento');
        expect(descricao).not.toContain('mae.log@escola.test');
    });
});

describe('prazo como compromisso da escola', () => {
    it('a resposta promete 15 dias sem atribuir o prazo à LGPD', async () => {
        const mae = await criarUsuario({ email: 'mae.prazo@escola.test', perfil: 'responsavel' });
        const res = await pedirExclusao(mae);

        expect(res.body.message).toMatch(/15 dias/);
        expect(res.body.message).not.toMatch(/LGPD/i);
        expect(res.body.message).not.toMatch(/dias úteis/i);
    });
});

describe('escola do pedido', () => {
    it('conta de equipe: grava o id da escola, não o nome', async () => {
        const prof = await criarUsuario({
            email: 'prof.escola@escola.test',
            perfil: 'professor',
            escola: 'EMEF Nome Por Extenso',
            escolaId: 'escola-id-1',
        });
        const res = await pedirExclusao(prof);
        const pedido = await PedidoTitular.findOne({ protocolo: res.body.protocolo });
        expect(pedido.escolaId).toBe('escola-id-1');
    });

    it('responsável sem escola na conta: herda a escola do filho', async () => {
        const mae = await criarUsuario({ email: 'mae.filho@escola.test', perfil: 'responsavel' });
        await Aluno.create({
            nome: 'Criança Teste',
            turma: '2A',
            escolaId: 'escola-do-filho',
            responsavel: 'mae.filho@escola.test',
        });
        const res = await pedirExclusao(mae);
        const pedido = await PedidoTitular.findOne({ protocolo: res.body.protocolo });
        expect(pedido.escolaId).toBe('escola-do-filho');
    });
});

describe('protocolo', () => {
    it('não carrega pedaço do identificador da conta', async () => {
        const mae = await criarUsuario({ email: 'mae.proto@escola.test', perfil: 'responsavel' });
        const res = await pedirExclusao(mae);

        expect(res.body.protocolo).toMatch(/^LGPD-\d{8}-[0-9A-F]{8}$/);
        const fimDoId = String(mae._id).slice(-6).toUpperCase();
        expect(res.body.protocolo.endsWith(fimDoId)).toBe(false);
    });
});

describe('fila da administração', () => {
    function respostaFalsa() {
        const res = {};
        res.status = jest.fn(() => res);
        res.json = jest.fn((corpo) => {
            res.corpo = corpo;
            return res;
        });
        return res;
    }

    async function pedido(protocolo, escolaId) {
        return PedidoTitular.create({
            protocolo,
            usuarioId: 'u1',
            usuarioEmail: `${protocolo.toLowerCase()}@escola.test`,
            usuarioNome: 'Titular',
            perfil: 'responsavel',
            escolaId,
            tipo: 'exclusao',
            status: 'pendente',
            prazoAtendimento: new Date(Date.now() + 86400000),
        });
    }

    it('com escola no contexto, a busca continua valendo', async () => {
        await pedido('LGPD-ALVO-1', 'escola-a');
        await pedido('LGPD-OUTRO-2', 'escola-a');
        await pedido('LGPD-ALVO-3', 'escola-b');

        const res = respostaFalsa();
        await listarPedidos(
            { query: { busca: 'ALVO' }, escolaId: 'escola-a', user: { perfil: 'admin' } },
            res
        );

        const protocolos = res.corpo.data.map((p) => p.protocolo);
        expect(protocolos).toEqual(['LGPD-ALVO-1']);
    });
});
