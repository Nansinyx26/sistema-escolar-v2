/**
 * audioChatbotPresenca.test.js — Issue #688
 *
 * 1. Comentário aceitava `audioUrl` de qualquer arquivo: quem conhecia o id de
 *    um áudio de outra conversa o republicava e voltava a ouvi-lo.
 * 2. O chatbot buscava a grade horária só pelo nome da turma, sem escola.
 * 3. A presença online de qualquer conta ia para a sala da escola inteira,
 *    responsáveis inclusive.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Comunicado = require('../models/Comunicado');
const Comentario = require('../models/Comentario');
const GradeHoraria = require('../models/GradeHoraria');
const { saveToGridFS } = require('../utils/gridfs');
const { fetchGradeHoraria } = require('../services/ChatbotService');
const { emitirPresenca } = require('../utils/realtime');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

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

const cookieDe = (u) => [`escola_jwt=${assinarTokenSessao(u)}`];

describe('áudio do comentário', () => {
    async function audioDe(usuario) {
        const id = await saveToGridFS(Buffer.from('audio'), 'gravacao.webm', 'audio/webm', {
            usuarioId: String(usuario._id),
            escolaId: A,
            type: 'voice_message',
        });
        return `/api/audio/${id}`;
    }

    async function comentar(usuario, corpo) {
        const comunicado = await Comunicado.create({
            escolaId: A,
            titulo: 'Aviso',
            conteudo: 'Texto',
            destinatarios: ['todos'],
            ativo: true,
        });
        return request(app)
            .post('/api/comentarios')
            .set('Cookie', cookieDe(usuario))
            .send({ comunicadoId: String(comunicado._id), ...corpo });
    }

    it('aceita o áudio gravado pelo próprio autor', async () => {
        const diretor = await criarUsuario({ perfil: 'diretor', escolaId: A });
        const audioUrl = await audioDe(diretor);

        const res = await comentar(diretor, { audioUrl });

        expect(res.status).toBe(201);
        expect((await Comentario.findOne({}).lean()).audioUrl).toBe(audioUrl);
    });

    it('recusa o áudio gravado por outra pessoa', async () => {
        const diretor = await criarUsuario({ perfil: 'diretor', escolaId: A });
        const outra = await criarUsuario({ perfil: 'professor', escolaId: A });
        const audioUrl = await audioDe(outra);

        const res = await comentar(diretor, { audioUrl });

        expect(res.status).toBe(400);
        expect(await Comentario.countDocuments({})).toBe(0);
    });

    it('recusa endereço que não é áudio de comentário', async () => {
        const diretor = await criarUsuario({ perfil: 'diretor', escolaId: A });
        const foto = await saveToGridFS(Buffer.from('x'), 'foto.png', 'image/png', {
            usuarioId: String(diretor._id),
            type: 'avatar',
        });

        for (const audioUrl of [
            `/api/audio/${foto}`,
            'https://outro.site/a.mp3',
            '/api/files/abc',
        ]) {
            expect((await comentar(diretor, { audioUrl })).status).toBe(400);
        }
    });

    it('comentário só de texto continua valendo', async () => {
        const diretor = await criarUsuario({ perfil: 'diretor', escolaId: A });

        const res = await comentar(diretor, { texto: 'Combinado!' });

        expect(res.status).toBe(201);
    });
});

describe('grade horária no chatbot', () => {
    it('traz só a grade da escola', async () => {
        const aula = (escolaId, disciplina) =>
            GradeHoraria.create({
                escolaId,
                professorId: 'p',
                turmaId: '1A',
                disciplina,
                diaSemana: 1,
                horaInicio: '07:00',
                horaFim: '07:50',
            });
        await aula(A, 'Matemática');
        await aula(B, 'História');

        const grade = await fetchGradeHoraria({ turmaId: '1A', escolaId: A });

        expect(grade.map((g) => g.disciplina)).toEqual(['Matemática']);
    });
});

describe('presença online', () => {
    it('vai só para a equipe da escola, não para os responsáveis', async () => {
        const sockets = [
            { nome: 'diretor', salas: ['role:diretor', `escola:${A}`] },
            { nome: 'professor', salas: ['role:professor', `escola:${A}`] },
            { nome: 'responsavel', salas: ['role:responsavel', `escola:${A}`] },
            { nome: 'professor-da-B', salas: ['role:professor', `escola:${B}`] },
        ];
        const recebidos = [];
        global.io = {
            in: (sala) => ({
                fetchSockets: async () =>
                    sockets
                        .filter((s) => s.salas.includes(sala))
                        .map((s) => ({
                            rooms: new Set(s.salas),
                            emit: () => recebidos.push(s.nome),
                        })),
            }),
        };

        await emitirPresenca(A, {
            userId: 'u1',
            online: true,
            status: 'online',
            perfil: 'responsavel',
        });

        expect(recebidos.sort()).toEqual(['diretor', 'professor']);
    });
});
