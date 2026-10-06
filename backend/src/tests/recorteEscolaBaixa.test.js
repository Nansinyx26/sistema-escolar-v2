/**
 * recorteEscolaBaixa.test.js — Issue #675
 *
 * Itens de baixa gravidade da revisão de segurança: rotas que ignoravam a
 * escola da sessão ou gravavam o corpo inteiro. Cada caso passa PELA ROTA, com
 * duas escolas ativas.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Diretor = require('../models/Diretor');
const Secretaria = require('../models/Secretaria');
const Professor = require('../models/Professor');
const Turma = require('../models/Turma');
const Nota = require('../models/Nota');
const GradeHoraria = require('../models/GradeHoraria');
const Comentario = require('../models/Comentario');
const Notificacao = require('../models/Notificacao');
const MessageReaction = require('../models/MessageReaction');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

const CARGO = { diretor: Diretor, secretaria: Secretaria };
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

const cookieDe = (usuario) => [`escola_jwt=${assinarTokenSessao(usuario)}`];

async function equipe(perfil, escolaId) {
    const usuario = await criarUsuario({ perfil, escolaId });
    await CARGO[perfil].create({
        idUsuario: String(usuario._id),
        nome: usuario.nome,
        email: usuario.email,
        vinculos: [{ escolaId, cargo: perfil }],
    });
    return { usuario, cookie: cookieDe(usuario) };
}

describe('grade horária', () => {
    async function aula(escolaId, professorId, disciplina) {
        return GradeHoraria.create({
            escolaId,
            professorId,
            turmaId: 'turma-1A',
            disciplina,
            diaSemana: 1,
            horaInicio: '07:00',
            horaFim: '07:50',
        });
    }

    it('lista só a grade da escola da sessão', async () => {
        const sec = await equipe('secretaria', A);
        await aula(A, 'prof-a', 'Matemática');
        await aula(B, 'prof-b', 'História');

        const res = await request(app).get('/api/grade-horaria').set('Cookie', sec.cookie);

        expect(res.status).toBe(200);
        expect(res.body.data.map((g) => g.disciplina)).toEqual(['Matemática']);
    });

    it('o responsável vê o nome do professor, não o e-mail', async () => {
        const prof = await Professor.create({ nome: 'Prof Ana', email: 'ana.675@escola.test' });
        await aula(A, String(prof._id), 'Matemática');
        const resp = await criarUsuario({ perfil: 'responsavel', escolaId: A });

        const res = await request(app).get('/api/grade-horaria').set('Cookie', cookieDe(resp));

        expect(res.status).toBe(200);
        const professor = res.body.data[0].professorDetails;
        expect(professor.nome).toBe('Prof Ana');
        expect(professor.email).toBeUndefined();
    });
});

describe('comentários', () => {
    it('a direção não desativa comentário de outra escola', async () => {
        const dir = await equipe('diretor', A);
        const autor = await criarUsuario({ perfil: 'responsavel', escolaId: B });
        const daB = await Comentario.create({
            escolaId: B,
            usuarioId: autor._id,
            usuarioNome: autor.nome,
            texto: 'Comentário da B',
        });

        const res = await request(app)
            .delete(`/api/comentarios/${daB._id}`)
            .set('Cookie', dir.cookie);

        expect(res.status).toBe(403);
        expect((await Comentario.findById(daB._id)).ativo).toBe(true);
    });

    it('a direção desativa comentário da própria escola', async () => {
        const dir = await equipe('diretor', A);
        const autor = await criarUsuario({ perfil: 'responsavel', escolaId: A });
        const daA = await Comentario.create({
            escolaId: A,
            usuarioId: autor._id,
            usuarioNome: autor.nome,
            texto: 'Comentário da A',
        });

        const res = await request(app)
            .delete(`/api/comentarios/${daA._id}`)
            .set('Cookie', dir.cookie);

        expect(res.status).toBe(200);
        expect((await Comentario.findById(daA._id)).ativo).toBe(false);
    });
});

describe('turmas', () => {
    it('a turma nasce na escola da sessão, com os campos da lista', async () => {
        const dir = await equipe('diretor', A);

        const res = await request(app).post('/api/turmas').set('Cookie', dir.cookie).send({
            id: '5C',
            nome: '5C',
            ano: 5,
            escolaId: B,
            ativo: false,
            _id: 'turma-forjada',
        });

        expect(res.status).toBe(201);
        const turma = await Turma.findOne({ nome: '5C' }).lean();
        expect(turma.escolaId).toBe(A);
        expect(turma.ativo).toBe(true);
        expect(turma._id).not.toBe('turma-forjada');
    });
});

describe('notificações', () => {
    it('grava só os campos da lista e ignora o estado de leitura do corpo', async () => {
        const dir = await equipe('diretor', A);

        const res = await request(app)
            .post('/api/notificacoes')
            .set('Cookie', dir.cookie)
            .send({
                tipo: 'aviso',
                titulo: 'Reunião',
                mensagem: 'Sexta às 8h',
                destinatarios: 'professores',
                lido: ['alguem'],
                ocultadoPor: ['alguem'],
                comentariosCount: 99,
            });

        expect(res.status).toBe(201);
        const salva = await Notificacao.findOne({ titulo: 'Reunião' }).lean();
        expect(salva.escolaId).toBe(A);
        expect(salva.lido).toEqual([]);
        expect(salva.ocultadoPor).toEqual([]);
        expect(salva.comentariosCount).toBe(0);
    });

    it('paraResponsavel em texto não vale como verdadeiro', async () => {
        const sec = await equipe('secretaria', A);

        const res = await request(app).post('/api/notificacoes').set('Cookie', sec.cookie).send({
            tipo: 'aviso',
            titulo: 'Para as famílias',
            mensagem: 'Texto',
            destinatarios: 'todos',
            paraResponsavel: 'true',
        });

        expect(res.status).toBe(201);
        const salva = await Notificacao.findOne({ titulo: 'Para as famílias' }).lean();
        expect(salva.paraResponsavel).toBe(false);
    });
});

describe('reações', () => {
    async function reacao(escolaId, nome) {
        return MessageReaction.create({
            messageId: 'msg-675',
            senderId: `id-${nome}`,
            senderType: 'responsavel',
            senderName: nome,
            studentName: `Filho de ${nome}`,
            emoji: '👍',
            ...(escolaId ? { escolaId } : {}),
        });
    }

    it('a lista de quem reagiu fica na escola da sessão, com os registros antigos sem escola', async () => {
        const dir = await equipe('diretor', A);
        await reacao(A, 'Ana');
        await reacao(B, 'Bia');
        await reacao(null, 'Antigo');

        const res = await request(app)
            .get('/api/reactions/message/msg-675')
            .set('Cookie', dir.cookie);

        expect(res.status).toBe(200);
        expect(res.body.data.map((r) => r.senderName).sort()).toEqual(['Ana', 'Antigo']);
    });

    it('reagir a uma mensagem de outra escola não devolve quem reagiu lá', async () => {
        const dir = await equipe('diretor', A);
        await reacao(B, 'Bia');

        const res = await request(app)
            .post('/api/reactions')
            .set('Cookie', dir.cookie)
            .send({ messageId: 'msg-675', emoji: '👍' });

        expect([200, 201]).toContain(res.status);
        expect(res.body.allReactions.map((r) => r.senderName)).not.toContain('Bia');
        expect(res.body.data.escolaId).toBe(A);
    });
});

describe('relatório da turma na IA', () => {
    it('conta só os alunos da escola da sessão, e o cache não passa de uma escola para outra', async () => {
        const dirA = await equipe('diretor', A);
        const dirB = await equipe('diretor', B);
        const alunos = [
            await Aluno.create({ nome: 'Aluno A', turma: '7Z', ativo: true, escolaId: A }),
            await Aluno.create({ nome: 'Aluno B1', turma: '7Z', ativo: true, escolaId: B }),
            await Aluno.create({ nome: 'Aluno B2', turma: '7Z', ativo: true, escolaId: B }),
        ];
        for (const aluno of alunos) {
            await Nota.create({
                alunoId: String(aluno._id),
                materiaId: 'Matemática',
                nota: 7,
                bimestre: 1,
                escolaId: aluno.escolaId,
            });
        }

        const daA = await request(app).get('/api/ia/turma/7Z').set('Cookie', dirA.cookie);
        const daB = await request(app).get('/api/ia/turma/7Z').set('Cookie', dirB.cookie);

        expect(daA.status).toBe(200);
        expect(daA.body.totalAlunos).toBe(1);
        expect(daB.status).toBe(200);
        expect(daB.body.totalAlunos).toBe(2);
    });
});

describe('código secreto do aluno', () => {
    it('a gestão não regenera o código de aluno sem escola', async () => {
        const dir = await equipe('diretor', A);
        const semEscola = await Aluno.create({ nome: 'Sem escola', turma: '1A', ativo: true });

        const res = await request(app)
            .post(`/api/alunos/${semEscola._id}/regenerar-codigo`)
            .set('Cookie', dir.cookie);

        expect(res.status).toBe(403);
        expect(res.body.data).toBeUndefined();
    });

    it('a gestão regenera o código de aluno da própria escola', async () => {
        const dir = await equipe('diretor', A);
        const daA = await Aluno.create({ nome: 'Da A', turma: '1A', ativo: true, escolaId: A });

        const res = await request(app)
            .post(`/api/alunos/${daA._id}/regenerar-codigo`)
            .set('Cookie', dir.cookie);

        expect(res.status).toBe(200);
        expect(res.body.data.codigoSecreto).toBeTruthy();
    });

    it('a gestão não regenera o código de aluno de outra escola', async () => {
        const dir = await equipe('diretor', A);
        const daB = await Aluno.create({ nome: 'Da B', turma: '1A', ativo: true, escolaId: B });

        const res = await request(app)
            .post(`/api/alunos/${daB._id}/regenerar-codigo`)
            .set('Cookie', dir.cookie);

        expect(res.status).toBe(403);
    });
});
