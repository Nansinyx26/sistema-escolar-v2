/**
 * comunicadoSoParaOPublico.test.js — Issue #663
 *
 * 1. `POST /api/comunicados/:id/read` devolvia o comunicado inteiro de qualquer
 *    escola ou público a quem soubesse o `_id`.
 * 2. `comunicado:new` ia para a sala da escola inteira, responsáveis inclusive,
 *    qualquer que fosse o público do comunicado.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Comunicado = require('../models/Comunicado');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { emitirComunicadoNovo } = require('../services/publicoDoComunicado');

let A;
let B;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    A = String((await Escola.create({ nome: 'EMEF Alfa', tipo: 'EMEF', ativo: true }))._id);
    B = String((await Escola.create({ nome: 'EMEF Beta', tipo: 'EMEF', ativo: true }))._id);
    invalidarCacheEscolas();
});
afterEach(() => {
    delete global.io;
});

async function familia(escolaId, turma = '1A', extraAluno = {}) {
    const email = `fam.${Math.random().toString(36).slice(2)}@escola.test`;
    const usuario = await criarUsuario({ perfil: 'responsavel', email, escolaId });
    const aluno = await Aluno.create({
        nome: 'Filho',
        turma,
        ativo: true,
        escolaId,
        responsavel: email,
        ...extraAluno,
    });
    return { usuario, aluno, email, cookie: [`escola_jwt=${assinarTokenSessao(usuario)}`] };
}

const comunicado = (escolaId, destinatarios, extra = {}) =>
    Comunicado.create({
        escolaId,
        titulo: 'Aviso',
        conteudo: 'Conteúdo do aviso',
        destinatarios,
        ativo: true,
        ...extra,
    });

describe('POST /api/comunicados/:id/read', () => {
    it('comunicado de outra escola: 404 e nenhuma visualização gravada', async () => {
        const fam = await familia(A);
        const daB = await comunicado(B, ['todos']);

        const res = await request(app)
            .post(`/api/comunicados/${daB._id}/read`)
            .set('Cookie', fam.cookie);

        expect(res.status).toBe(404);
        expect(res.body.data).toBeUndefined();
        expect((await Comunicado.findById(daB._id).lean()).visualizacoes || []).toHaveLength(0);
    });

    it('comunicado só para professores da mesma escola: 404 para o responsável', async () => {
        const fam = await familia(A);
        const interno = await comunicado(A, ['professores']);

        const res = await request(app)
            .post(`/api/comunicados/${interno._id}/read`)
            .set('Cookie', fam.cookie);

        expect(res.status).toBe(404);
    });

    it('comunicado do público: grava a visualização e responde só o sucesso', async () => {
        const fam = await familia(A);
        const paraTodos = await comunicado(A, ['todos']);

        const res = await request(app)
            .post(`/api/comunicados/${paraTodos._id}/read`)
            .set('Cookie', fam.cookie);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true });
        const depois = await Comunicado.findById(paraTodos._id).lean();
        expect(depois.visualizacoes.map(String)).toContain(String(fam.usuario._id));
    });
});

describe('comunicado:new só para o público', () => {
    /**
     * Servidor de sockets simulado: cada socket tem as salas do handshake
     * (`user:<id>`, `role:<perfil>`, `escola:<id>`). Registra quem recebeu.
     */
    function servidor(sockets) {
        const recebidos = new Set();
        const entregarSala = (sala) => {
            for (const s of sockets) if (s.salas.includes(sala)) recebidos.add(s.nome);
        };
        global.io = {
            to: (sala) => ({ emit: () => entregarSala(sala) }),
            in: (sala) => ({
                fetchSockets: async () =>
                    sockets
                        .filter((s) => s.salas.includes(sala))
                        .map((s) => ({
                            rooms: new Set(s.salas),
                            emit: () => recebidos.add(s.nome),
                        })),
            }),
        };
        return recebidos;
    }

    const socketDe = (nome, usuario, escolaId) => ({
        nome,
        salas: [`user:${usuario._id}`, `role:${usuario.perfil}`, `escola:${escolaId}`],
    });

    async function escolaConectada() {
        const diretor = await criarUsuario({ perfil: 'diretor', escolaId: A });
        const professor = await criarUsuario({ perfil: 'professor', escolaId: A });
        const fam1A = await familia(A, '1A');
        const fam2B = await familia(A, '2B');
        const recebidos = servidor([
            socketDe('diretor', diretor, A),
            socketDe('professor', professor, A),
            socketDe('familia-1A', fam1A.usuario, A),
            socketDe('familia-2B', fam2B.usuario, A),
        ]);
        return { recebidos, fam1A, fam2B, professor };
    }

    it('para professores: não chega a responsável', async () => {
        const { recebidos } = await escolaConectada();

        await emitirComunicadoNovo(await comunicado(A, ['professores']));

        expect([...recebidos].sort()).toEqual(['diretor', 'professor']);
    });

    it('para uma turma: chega aos responsáveis dela e à gestão', async () => {
        const { recebidos } = await escolaConectada();

        await emitirComunicadoNovo(await comunicado(A, ['turma:1A']));

        expect([...recebidos].sort()).toEqual(['diretor', 'familia-1A']);
    });

    it('para uma família: chega a ela e à gestão', async () => {
        const { recebidos, fam2B } = await escolaConectada();

        await emitirComunicadoNovo(await comunicado(A, [`usuario:${fam2B.usuario._id}`]));

        expect([...recebidos].sort()).toEqual(['diretor', 'familia-2B']);
    });

    it('para todos: chega a todos da escola', async () => {
        const { recebidos } = await escolaConectada();

        await emitirComunicadoNovo(await comunicado(A, ['todos']));

        expect([...recebidos].sort()).toEqual(['diretor', 'familia-1A', 'familia-2B', 'professor']);
    });

    it('responsável bloqueado por decisão judicial não recebe o comunicado da turma', async () => {
        const diretor = await criarUsuario({ perfil: 'diretor', escolaId: A });
        const bloqueado = await familia(A, '1A');
        await Aluno.updateOne(
            { _id: bloqueado.aluno._id },
            { $set: { restricoesAcesso: [{ email: bloqueado.email, motivo: 'decisao_judicial' }] } }
        );
        const recebidos = servidor([
            socketDe('diretor', diretor, A),
            socketDe('bloqueado', bloqueado.usuario, A),
        ]);

        await emitirComunicadoNovo(await comunicado(A, ['1A']));

        expect([...recebidos]).toEqual(['diretor']);
    });
});
