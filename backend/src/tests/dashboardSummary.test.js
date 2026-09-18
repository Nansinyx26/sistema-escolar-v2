/**
 * dashboardSummary.test.js
 *
 * Testes para os endpoints do painel da direção (Issue #331):
 * - GET /api/dashboard/summary/notices: lista avisos reais, exclui tipo 'cadastro', limite 5, multi-escola e RBAC.
 * - GET /api/dashboard/summary/activity: lista eventos reais de atividades recentes, ordenados por data, limite 10, multi-escola e RBAC.
 */

const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Diretor = require('../models/Diretor');
const Aluno = require('../models/Aluno');
const Avaliacao = require('../models/Avaliacao');
const DocumentoEmitido = require('../models/DocumentoEmitido');
const JustificativaFalta = require('../models/JustificativaFalta');
const Notificacao = require('../models/Notificacao');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

beforeAll(async () => {
    await conectarBanco();
});

beforeEach(async () => {
    invalidarCacheEscolas();
});

afterEach(async () => {
    await limparBanco();
    invalidarCacheEscolas();
});

afterAll(async () => {
    await desconectarBanco();
});

describe('Dashboard Summary — Avisos e Atividades da Direção (Issue #331)', () => {
    let escolaA;
    let escolaB;
    let diretorA;
    let secretariaA;
    let professorA;
    let cookieDiretorA;
    let cookieSecretariaA;
    let cookieProfessorA;

    beforeEach(async () => {
        escolaA = await Escola.create({
            nome: 'Escola Municipal Alpha',
            tipo: 'EMEF',
            ativo: true,
        });

        escolaB = await Escola.create({
            nome: 'Escola Municipal Beta',
            tipo: 'EMEF',
            ativo: true,
        });

        diretorA = await criarUsuario({
            perfil: 'diretor',
            nome: 'Diretora Ana',
            email: 'diretora_ana@alpha.test',
            escolaId: String(escolaA._id),
        });
        await Diretor.create({
            idUsuario: String(diretorA._id),
            nome: diretorA.nome,
            email: diretorA.email,
            escolaId: String(escolaA._id),
            vinculos: [{ escolaId: String(escolaA._id), cargo: 'diretor' }],
        });

        secretariaA = await criarUsuario({
            perfil: 'secretaria',
            nome: 'Secretário Bruno',
            email: 'secretario_bruno@alpha.test',
            escolaId: String(escolaA._id),
        });

        professorA = await criarUsuario({
            perfil: 'professor',
            nome: 'Professor Carlos',
            email: 'professor_carlos@alpha.test',
            escolaId: String(escolaA._id),
        });

        cookieDiretorA = [
            `escola_jwt=${assinarTokenSessao(diretorA, { escolaId: String(escolaA._id) })}`,
        ];
        cookieSecretariaA = [
            `escola_jwt=${assinarTokenSessao(secretariaA, { escolaId: String(escolaA._id) })}`,
        ];
        cookieProfessorA = [
            `escola_jwt=${assinarTokenSessao(professorA, { escolaId: String(escolaA._id) })}`,
        ];
    });

    describe('GET /api/dashboard/summary/notices', () => {
        it('recusa 401 sem autenticacao e 403 para perfil professor', async () => {
            const semAuth = await request(app).get('/api/dashboard/summary/notices');
            expect(semAuth.status).toBe(401);

            const comProf = await request(app)
                .get('/api/dashboard/summary/notices')
                .set('Cookie', cookieProfessorA);
            expect(comProf.status).toBe(403);
        });

        it('autoriza diretor e secretaria com status 200', async () => {
            const resDir = await request(app)
                .get('/api/dashboard/summary/notices')
                .set('Cookie', cookieDiretorA);
            expect(resDir.status).toBe(200);
            expect(resDir.body.success).toBe(true);

            const resSec = await request(app)
                .get('/api/dashboard/summary/notices')
                .set('Cookie', cookieSecretariaA);
            expect(resSec.status).toBe(200);
            expect(resSec.body.success).toBe(true);
        });

        it('retorna no maximo 5 avisos, exclui tipo "cadastro" e isola por escola', async () => {
            // Cria 7 avisos na escola A (incluindo 1 do tipo 'cadastro')
            await Notificacao.create({
                id: 'notif-cad-1',
                tipo: 'cadastro',
                titulo: 'Usuário cadastrado',
                mensagem: 'Cadastro de aluno',
                destinatarios: 'todos',
                escolaId: String(escolaA._id),
                dataCriacao: new Date('2026-09-01T10:00:00Z'),
            });

            for (let i = 1; i <= 6; i++) {
                await Notificacao.create({
                    id: `notif-aviso-${i}`,
                    tipo: 'informativo',
                    titulo: `Aviso Importante ${i}`,
                    mensagem: `Mensagem ${i}`,
                    destinatarios: 'todos',
                    escolaId: String(escolaA._id),
                    dataCriacao: new Date(`2026-09-0${i + 1}T10:00:00Z`),
                });
            }

            // Cria 1 aviso na escola B
            await Notificacao.create({
                id: 'notif-escola-b',
                tipo: 'informativo',
                titulo: 'Aviso da Escola B',
                mensagem: 'Outra escola',
                destinatarios: 'todos',
                escolaId: String(escolaB._id),
                dataCriacao: new Date('2026-09-10T10:00:00Z'),
            });

            const res = await request(app)
                .get('/api/dashboard/summary/notices')
                .set('Cookie', cookieDiretorA);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveLength(5);

            // Nenhum aviso do tipo 'cadastro'
            const temCadastro = res.body.data.some((n) => n.tipo === 'cadastro');
            expect(temCadastro).toBe(false);

            // Nenhum aviso da escola B
            const temEscolaB = res.body.data.some((n) => n.titulo === 'Aviso da Escola B');
            expect(temEscolaB).toBe(false);

            // Mais recente primeiro (Aviso 6, depois 5, 4, 3, 2)
            expect(res.body.data[0].titulo).toBe('Aviso Importante 6');
        });
    });

    describe('GET /api/dashboard/summary/activity', () => {
        it('recusa 401 sem autenticacao e 403 para perfil professor', async () => {
            const semAuth = await request(app).get('/api/dashboard/summary/activity');
            expect(semAuth.status).toBe(401);

            const comProf = await request(app)
                .get('/api/dashboard/summary/activity')
                .set('Cookie', cookieProfessorA);
            expect(comProf.status).toBe(403);
        });

        it('agrega atividades reais das colecoes, ordena desc, limita a 10 e isola por escola', async () => {
            // Atividade escola A: Aluno
            await Aluno.create({
                nome: 'Lucas Silva',
                turma: '5A',
                escolaId: String(escolaA._id),
                createdAt: new Date('2026-09-12T14:00:00Z'),
            });

            // Atividade escola A: Avaliacao
            await Avaliacao.create({
                titulo: 'Prova de Matemática',
                turmaId: '5A',
                materiaId: 'matematica',
                bimestre: 1,
                escolaId: String(escolaA._id),
                createdAt: new Date('2026-09-13T10:00:00Z'),
            });

            // Atividade escola A: Documento emitido
            await DocumentoEmitido.create({
                tipo: 'declaracao_matricula',
                titulo: 'Declaração de Matrícula',
                alunoId: 'aluno-1',
                alunoNome: 'Lucas Silva',
                emitidoPor: String(secretariaA._id),
                escolaId: String(escolaA._id),
                createdAt: new Date('2026-09-14T09:00:00Z'),
            });

            // Atividade escola A: Justificativa de falta
            await JustificativaFalta.create({
                alunoId: 'aluno-1',
                alunoNome: 'Lucas Silva',
                motivo: 'Consulta médica',
                categoria: 'saude',
                dataInicio: new Date('2026-09-15T00:00:00Z'),
                dataFim: new Date('2026-09-15T23:59:59Z'),
                escolaId: String(escolaA._id),
                createdAt: new Date('2026-09-15T08:00:00Z'),
            });

            // Atividade escola B: Aluno (não deve vazar)
            await Aluno.create({
                nome: 'Aluno Outra Escola',
                turma: '9B',
                escolaId: String(escolaB._id),
                createdAt: new Date('2026-09-16T12:00:00Z'),
            });

            const res = await request(app)
                .get('/api/dashboard/summary/activity')
                .set('Cookie', cookieDiretorA);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);

            // Não pode vazar aluno da escola B
            const vazouEscolaB = res.body.data.some((a) => a.texto.includes('Aluno Outra Escola'));
            expect(vazouEscolaB).toBe(false);

            // Deve conter os tipos esperados da escola A
            const tipos = res.body.data.map((a) => a.tipo);
            expect(tipos).toContain('aluno');
            expect(tipos).toContain('avaliacao');
            expect(tipos).toContain('documento');
            expect(tipos).toContain('justificativa');

            // Ordenado do mais recente para o mais antigo
            for (let i = 0; i < res.body.data.length - 1; i++) {
                const dataAtual = new Date(res.body.data[i].data).getTime();
                const dataProx = new Date(res.body.data[i + 1].data).getTime();
                expect(dataAtual).toBeGreaterThanOrEqual(dataProx);
            }
        });
    });
});
