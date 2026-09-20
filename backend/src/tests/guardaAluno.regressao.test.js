/**
 * guardaAluno.regressao.test.js — Issue #397
 *
 * Toda rota que recebe identificador de aluno, nota ou documento decide o
 * acesso pela mesma guarda (escola + turma + vínculo), e não pelo perfil.
 * Prova, das duas pontas: a gestão da escola A não alcança recurso da escola B,
 * e quem é da escola continua alcançando o que é dela.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Nota = require('../models/Nota');
const Falta = require('../models/Falta');
const Diretor = require('../models/Diretor');
const Professor = require('../models/Professor');
const Turma = require('../models/Turma');
const GradeHoraria = require('../models/GradeHoraria');
const AuditLog = require('../models/AuditLog');
const DocumentoResponsavel = require('../models/DocumentoResponsavel');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { saveToGridFS } = require('../utils/gridfs');

let escolaA;
let escolaB;
let alunoA;
let alunoB;
let dirA;

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

async function diretorDe(escola, email) {
    const u = await criarUsuario({ email, perfil: 'diretor', escolaId: String(escola._id) });
    await Diretor.create({
        idUsuario: String(u._id),
        nome: u.nome,
        email: u.email,
        vinculos: [{ escolaId: String(escola._id), cargo: 'diretor' }],
    });
    return u;
}

async function documentoDe(aluno, escola) {
    const pdf = Buffer.from('%PDF-1.4 fixture');
    const storageId = await saveToGridFS(pdf, 'ficha.pdf', 'application/pdf', {
        alunoId: String(aluno._id),
        escolaId: String(escola._id),
        type: 'documento_responsavel',
    });
    return DocumentoResponsavel.create({
        alunoId: String(aluno._id),
        responsavelId: 'resp-fixture',
        tipoDocumento: 'Autorização',
        nomeDocumento: 'Passeio',
        escolaId: String(escola._id),
        arquivo: {
            nomeOriginal: 'ficha.pdf',
            url: 'x',
            storageId: String(storageId),
            mimeType: 'application/pdf',
            tamanho: pdf.length,
        },
    });
}

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
    alunoA = await Aluno.create({
        escolaId: String(escolaA._id),
        nome: 'Aluno da A',
        turma: '1A',
        cpfAluno: '00000000191',
    });
    alunoB = await Aluno.create({
        escolaId: String(escolaB._id),
        nome: 'Aluno da B',
        turma: '1B',
        cpfAluno: '00000000272',
    });
    dirA = await diretorDe(escolaA, 'dir.a@escola.test');
    invalidarCacheEscolas();
});

describe('a gestão de uma escola não alcança recurso de outra', () => {
    it('status da ficha de documentos: 403 e nenhum dado do aluno na resposta', async () => {
        const res = await request(app)
            .put(`/api/responsavel/aluno/${alunoB._id}/documento-status`)
            .set('Cookie', cookieDe(dirA))
            .send({ status: 'conferido' });
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).not.toContain('00000000272');
        expect((await Aluno.findById(alunoB._id).lean()).fichaDocumentoStatus).toBe('pendente');
    });

    it('nota: leitura, edição e exclusão de aluno de outra escola → 403', async () => {
        const nota = await Nota.create({
            alunoId: String(alunoB._id),
            turmaId: '1B',
            materiaId: 'MAT',
            bimestre: 1,
            nota: 8,
            escolaId: String(escolaB._id),
        });
        const c = cookieDe(dirA);
        expect((await request(app).get(`/api/notas/${nota._id}`).set('Cookie', c)).status).toBe(
            403
        );
        expect(
            (await request(app).put(`/api/notas/${nota._id}`).set('Cookie', c).send({ nota: 1 }))
                .status
        ).toBe(403);
        expect((await request(app).delete(`/api/notas/${nota._id}`).set('Cookie', c)).status).toBe(
            403
        );
        expect((await Nota.findById(nota._id).lean()).nota).toBe(8);
    });

    it.each([
        ['visualizar', (id) => `/api/documentos-responsaveis/${id}/visualizar`],
        ['download', (id) => `/api/documentos-responsaveis/${id}/download`],
    ])('documento assinado (%s) de outra escola → 403', async (_nome, caminho) => {
        const doc = await documentoDe(alunoB, escolaB);
        const res = await request(app).get(caminho(doc._id)).set('Cookie', cookieDe(dirA));
        expect(res.status).toBe(403);
    });

    it('lista de documentos e mudança de status de aluno de outra escola → 403', async () => {
        const doc = await documentoDe(alunoB, escolaB);
        const lista = await request(app)
            .get(`/api/documentos-responsaveis/aluno/${alunoB._id}`)
            .set('Cookie', cookieDe(dirA));
        expect(lista.status).toBe(403);

        const status = await request(app)
            .patch(`/api/documentos-responsaveis/${doc._id}/status`)
            .set('Cookie', cookieDe(dirA))
            .send({ status: 'Conferido' });
        expect(status.status).toBe(403);
        expect((await DocumentoResponsavel.findById(doc._id).lean()).status).toBe('Enviado');
    });
});

describe('o que é da escola continua funcionando', () => {
    it('status da ficha responde com o mínimo e deixa registro', async () => {
        const res = await request(app)
            .put(`/api/responsavel/aluno/${alunoA._id}/documento-status`)
            .set('Cookie', cookieDe(dirA))
            .send({ status: 'conferido' });
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ id: String(alunoA._id), status: 'conferido' });
        expect(await AuditLog.countDocuments({ acao: 'DOCUMENTO_ALUNO_STATUS' })).toBe(1);
    });

    it('documento da própria escola abre', async () => {
        const doc = await documentoDe(alunoA, escolaA);
        const res = await request(app)
            .get(`/api/documentos-responsaveis/${doc._id}/download`)
            .set('Cookie', cookieDe(dirA));
        expect(res.status).toBe(200);
    });

    it('nota da própria escola é lida e editada', async () => {
        const nota = await Nota.create({
            alunoId: String(alunoA._id),
            turmaId: '1A',
            materiaId: 'MAT',
            bimestre: 1,
            nota: 7,
            escolaId: String(escolaA._id),
        });
        const leitura = await request(app)
            .get(`/api/notas/${nota._id}`)
            .set('Cookie', cookieDe(dirA));
        expect(leitura.status).toBe(200);
        const edicao = await request(app)
            .put(`/api/notas/${nota._id}`)
            .set('Cookie', cookieDe(dirA))
            .send({ nota: 9 });
        expect(edicao.status).toBe(200);
    });
});

describe('chamada', () => {
    // A chamada passa antes pelo `verifyTimetable`: só grava quem tem aula
    // daquela turma no dia. A fixture monta turma, professor e grade para o
    // teste chegar ao controller, que é o que está sob prova aqui.
    const DATA_SEGUNDA = '2026-09-21'; // segunda-feira

    async function professorDaTurma() {
        const u = await criarUsuario({
            email: 'prof.a@escola.test',
            perfil: 'professor',
            escolaId: String(escolaA._id),
        });
        const prof = await Professor.create({
            idUsuario: String(u._id),
            nome: u.nome,
            email: u.email,
            salaPrincipal: '1A',
            vinculos: [{ escolaId: String(escolaA._id), cargo: 'professor' }],
            ativo: true,
        });
        await Turma.create({ nome: '1A', escolaId: String(escolaA._id) });
        await GradeHoraria.create({
            professorId: String(prof._id),
            turmaId: '1A',
            disciplina: 'Sala Principal',
            diaSemana: 1,
            horaInicio: '07:00',
            horaFim: '17:00',
            ativo: true,
            escolaId: String(escolaA._id),
        });
        return u;
    }

    /** Corpo mínimo que o `verifyTimetable` aceita. */
    function corpoDaChamada(extra) {
        return {
            nomeProfessor: 'Professor Teste',
            turma: '1A',
            materia: 'Sala Principal',
            data: DATA_SEGUNDA,
            ...extra,
        };
    }

    it('não grava falta no nome de aluno de outra turma', async () => {
        const prof = await professorDaTurma();
        const res = await request(app)
            .post('/api/faltas')
            .set('Cookie', cookieDe(prof))
            .send(corpoDaChamada({ aluno: String(alunoB._id), presente: false }));
        expect(res.status).toBe(403);
        expect(await Falta.countDocuments({})).toBe(0);
    });

    it('a escola vem do contexto, nunca do corpo', async () => {
        const prof = await professorDaTurma();
        const res = await request(app)
            .post('/api/faltas')
            .set('Cookie', cookieDe(prof))
            .send(
                corpoDaChamada({
                    aluno: String(alunoA._id),
                    presente: true,
                    escolaId: String(escolaB._id),
                })
            );
        expect(res.status).toBe(201);
        expect((await Falta.findOne({}).lean()).escolaId).toBe(String(escolaA._id));
    });

    it('sincronização recusa lista com aluno de fora da turma', async () => {
        const prof = await professorDaTurma();
        const res = await request(app)
            .post('/api/faltas/sync')
            .set('Cookie', cookieDe(prof))
            .send(
                corpoDaChamada({
                    presencas: [
                        { alunoId: String(alunoA._id), presente: true },
                        { alunoId: String(alunoB._id), presente: false },
                    ],
                })
            );
        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('ALUNO_FORA_DA_TURMA');
        expect(await Falta.countDocuments({})).toBe(0);
    });

    it('sincronização da própria turma grava normalmente', async () => {
        const prof = await professorDaTurma();
        const res = await request(app)
            .post('/api/faltas/sync')
            .set('Cookie', cookieDe(prof))
            .send(corpoDaChamada({ presencas: [{ alunoId: String(alunoA._id), presente: true }] }));
        expect(res.status).toBe(200);
        expect(await Falta.countDocuments({})).toBe(1);
    });
});
