/**
 * muralSoComVinculo.test.js — Issue #687
 *
 * 1. Conta de responsável sem filho vinculado (login Google, por exemplo) era
 *    levada à escola ativa única e lia o mural, os comentários, o sino e
 *    entrava na sala `message:<id>`: `todos` e `responsaveis` não exigiam
 *    vínculo. Agora exigem filho vinculado na escola do aviso.
 * 2. No `join:message`, a fronteira de escola era pulada quando o socket não
 *    tinha escola resolvida (equipe com 2+ vínculos e sem escola na conta).
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Diretor = require('../models/Diretor');
const Comunicado = require('../models/Comunicado');
const Comentario = require('../models/Comentario');
const Notificacao = require('../models/Notificacao');
const JWT_SECRET = require('../utils/jwtConfig');
const { criarAutenticacaoSocket } = require('../realtime/autenticarSocket');
const { podeAcessarMensagem } = require('../realtime/acessoAMensagem');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

let A;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    A = String((await Escola.create({ nome: 'EMEF Alfa', tipo: 'EMEF', ativo: true }))._id);
    invalidarCacheEscolas();
});

const cookieDe = (u) => [`escola_jwt=${assinarTokenSessao(u)}`];

async function responsavel({ comFilhoEm } = {}) {
    const email = `resp.${Math.random().toString(36).slice(2)}@escola.test`;
    const usuario = await criarUsuario({ perfil: 'responsavel', email, escolaId: A });
    if (comFilhoEm) {
        await Aluno.create({
            nome: 'Filho',
            turma: '1A',
            ativo: true,
            escolaId: comFilhoEm,
            responsavel: email,
        });
    }
    return usuario;
}

const comunicado = (escolaId, destinatarios, titulo = 'Festa da escola') =>
    Comunicado.create({
        escolaId,
        titulo,
        conteudo: 'Conteúdo',
        destinatarios,
        ativo: true,
    });

describe('HTTP', () => {
    it('sem filho: o mural não traz o comunicado para todos, só o pessoal', async () => {
        const semFilho = await responsavel();
        await comunicado(A, ['todos'], 'Para todos');
        await comunicado(A, [`usuario:${semFilho._id}`], 'Só para ele');

        const res = await request(app).get('/api/comunicados').set('Cookie', cookieDe(semFilho));

        expect(res.status).toBe(200);
        expect(res.body.data.map((c) => c.titulo)).toEqual(['Só para ele']);
    });

    it('com filho na escola: o mural traz o comunicado para todos', async () => {
        const comFilho = await responsavel({ comFilhoEm: A });
        await comunicado(A, ['todos'], 'Para todos');

        const res = await request(app).get('/api/comunicados').set('Cookie', cookieDe(comFilho));

        expect(res.body.data.map((c) => c.titulo)).toEqual(['Para todos']);
    });

    it('sem filho: não abre o comunicado nem os comentários dele', async () => {
        const semFilho = await responsavel();
        const paraTodos = await comunicado(A, ['todos']);
        const outro = await criarUsuario({ perfil: 'responsavel', escolaId: A });
        await Comentario.create({
            escolaId: A,
            comunicadoId: paraTodos._id,
            usuarioId: outro._id,
            usuarioNome: 'Outra família',
            texto: 'Comentário de uma família',
        });

        const leitura = await request(app)
            .get(`/api/comunicados/${paraTodos._id}`)
            .set('Cookie', cookieDe(semFilho));
        const comentarios = await request(app)
            .get(`/api/comentarios/comunicado/${paraTodos._id}`)
            .set('Cookie', cookieDe(semFilho));

        expect([403, 404]).toContain(leitura.status);
        expect([403, 404]).toContain(comentarios.status);
        expect(JSON.stringify(comentarios.body)).not.toContain('Comentário de uma família');
    });

    it('sem filho: o sino não traz o aviso para todos; com filho, traz', async () => {
        const semFilho = await responsavel();
        const comFilho = await responsavel({ comFilhoEm: A });
        await Notificacao.create({
            tipo: 'informativo',
            titulo: 'Aviso às famílias',
            mensagem: 'Texto',
            destinatarios: ['todos'],
            paraResponsavel: true,
            escolaId: A,
        });

        const deSemFilho = await request(app)
            .get('/api/notificacoes')
            .set('Cookie', cookieDe(semFilho));
        const deComFilho = await request(app)
            .get('/api/notificacoes')
            .set('Cookie', cookieDe(comFilho));

        const titulos = (res) => (res.body.data || []).map((n) => n.titulo);
        expect(titulos(deSemFilho)).not.toContain('Aviso às famílias');
        expect(titulos(deComFilho)).toContain('Aviso às famílias');
    });
});

describe('Socket.IO', () => {
    const socketDe = (usuario, escolaId) => ({
        escolaId,
        user: { id: String(usuario._id), email: usuario.email, perfil: usuario.perfil },
    });

    it('join:message: responsável sem filho não entra; com filho, entra', async () => {
        const semFilho = await responsavel();
        const comFilho = await responsavel({ comFilhoEm: A });
        const paraTodos = await comunicado(A, ['todos']);

        expect(await podeAcessarMensagem(socketDe(semFilho, null), String(paraTodos._id))).toBe(
            false
        );
        expect(await podeAcessarMensagem(socketDe(comFilho, null), String(paraTodos._id))).toBe(
            true
        );
    });

    it('join:message: equipe sem escola no socket não entra em escola a que não pertence', async () => {
        const B = String(
            (await Escola.create({ nome: 'EMEF Beta', tipo: 'EMEF', ativo: true }))._id
        );
        const C = String(
            (await Escola.create({ nome: 'EMEF Gama', tipo: 'EMEF', ativo: true }))._id
        );
        const diretor = await criarUsuario({ perfil: 'diretor' });
        await Diretor.create({
            idUsuario: String(diretor._id),
            nome: diretor.nome,
            email: diretor.email,
            vinculos: [
                { escolaId: A, cargo: 'diretor' },
                { escolaId: C, cargo: 'diretor' },
            ],
        });
        const internoDaB = await comunicado(B, ['professores'], 'Interno da Beta');
        const daA = await comunicado(A, ['professores'], 'Interno da Alfa');

        const socket = socketDe(diretor, null);
        expect(await podeAcessarMensagem(socket, String(internoDaB._id))).toBe(false);
        expect(await podeAcessarMensagem(socket, String(daA._id))).toBe(true);
    });

    it('handshake: responsável sem filho na escola da conta não entra na sala da escola', async () => {
        const semFilho = await responsavel();
        const comFilho = await responsavel({ comFilhoEm: A });
        const autenticar = criarAutenticacaoSocket(JWT_SECRET);
        const conectar = async (usuario) => {
            const socket = {
                handshake: { auth: { token: assinarTokenSessao(usuario) } },
                data: {},
            };
            await new Promise((resolve, reject) =>
                autenticar(socket, (err) => (err ? reject(err) : resolve()))
            );
            return socket;
        };

        expect((await conectar(semFilho)).escolaId).toBeNull();
        expect((await conectar(comFilho)).escolaId).toBe(A);
    });
});
