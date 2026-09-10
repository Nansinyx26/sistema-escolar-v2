/**
 * avaliacoesEscolares.test.js
 * ============================================================================
 * Testes para o Módulo de Avaliações Escolares e Lançamento de Notas:
 *   - Controle de Acesso (RBAC): Diretor, Secretaria, Professor vs Aluno/Responsável
 *   - Isolamento horizontal de turmas para Professores
 *   - Isolamento multi-escola (tenant isolation)
 *   - CRUD de Avaliações com validações
 *   - Lançamento de notas em lote com cálculo de métricas e status pedagógico
 *   - Trilha de auditoria e histórico de alterações com motivo
 * ============================================================================
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const mongoose = require('mongoose');

const Escola = require('../models/Escola');
const Diretor = require('../models/Diretor');
const Secretaria = require('../models/Secretaria');
const Professor = require('../models/Professor');
const Aluno = require('../models/Aluno');
const Avaliacao = require('../models/Avaliacao');
const Nota = require('../models/Nota');
const AvaliacaoHistorico = require('../models/AvaliacaoHistorico');

const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

let escolaA;
let escolaB;

beforeAll(async () => {
    await conectarBanco();
});

afterAll(async () => {
    await desconectarBanco();
});

beforeEach(async () => {
    await limparBanco();
    invalidarCacheEscolas();

    escolaA = await Escola.create({
        nome: 'Escola Modelo A',
        tipo: 'EMEF',
        ativo: true,
    });

    escolaB = await Escola.create({
        nome: 'Escola Modelo B',
        tipo: 'EMEF',
        ativo: false,
    });
});

afterEach(async () => {
    await limparBanco();
    invalidarCacheEscolas();
});

// Helpers para geração de tokens e cookies de teste
function gerarCookieAuth(usuario) {
    const token = jwt.sign(
        {
            id: usuario._id.toString(),
            perfil: usuario.perfil,
            email: usuario.email,
            nome: usuario.nome,
            escolaId: usuario.escolaId,
            purpose: 'session',
        },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
    return `escola_jwt=${token}`;
}

async function criarDiretorComCookie(escola) {
    const user = await criarUsuario({
        perfil: 'diretor',
        nome: 'Diretor Geral',
        email: `diretor_${Date.now()}@escola.test`,
        escolaId: String(escola._id),
    });
    await Diretor.create({
        idUsuario: String(user._id),
        nome: user.nome,
        email: user.email,
        escolaId: String(escola._id),
        vinculos: [{ escolaId: String(escola._id), cargo: 'diretor' }],
    });
    return { user, cookie: gerarCookieAuth(user) };
}

async function criarSecretariaComCookie(escola) {
    const user = await criarUsuario({
        perfil: 'secretaria',
        nome: 'Secretária Maria',
        email: `sec_${Date.now()}@escola.test`,
        escolaId: String(escola._id),
    });
    await Secretaria.create({
        idUsuario: String(user._id),
        nome: user.nome,
        email: user.email,
        escolaId: String(escola._id),
        vinculos: [{ escolaId: String(escola._id), cargo: 'secretaria' }],
    });
    return { user, cookie: gerarCookieAuth(user) };
}

async function criarProfessorComCookie(escola, turmas = ['7A', '7B']) {
    const user = await criarUsuario({
        perfil: 'professor',
        nome: 'Prof. Carlos',
        email: `prof_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@escola.test`,
        escolaId: String(escola._id),
    });
    await Professor.create({
        idUsuario: String(user._id),
        nome: user.nome,
        email: user.email,
        escola: 'default',
        turmas,
        salaPrincipal: turmas[0] || '7A',
        salasAdicionais: turmas.slice(1),
        ativo: true,
        vinculos: [{ escolaId: String(escola._id), cargo: 'professor' }],
    });
    return { user, cookie: gerarCookieAuth(user) };
}

describe('Módulo de Avaliações Escolares (/api/avaliacoes-escolares)', () => {
    describe('1. Autenticação e Autorização (RBAC)', () => {
        it('deve retornar 401 sem autenticação', async () => {
            const res = await request(app).get('/api/avaliacoes-escolares');
            expect(res.status).toBe(401);
        });

        it('deve rejeitar token com id de usuário inexistente no banco com 401', async () => {
            const token = jwt.sign(
                {
                    id: new mongoose.Types.ObjectId().toString(),
                    perfil: 'professor',
                    email: 'fantasma@escola.test',
                    nome: 'Usuário Fantasma',
                    escolaId: String(escolaA._id),
                    purpose: 'session',
                },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );
            const cookie = `escola_jwt=${token}`;

            const res = await request(app).get('/api/avaliacoes-escolares').set('Cookie', cookie);

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
        });

        it('deve retornar 403 para perfil responsavel', async () => {
            const respUser = await criarUsuario({
                perfil: 'responsavel',
                email: `resp_${Date.now()}@escola.test`,
                escolaId: String(escolaA._id),
            });
            const cookie = gerarCookieAuth(respUser);

            const res = await request(app).get('/api/avaliacoes-escolares').set('Cookie', cookie);

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
        });

        it('deve permitir acesso para diretor', async () => {
            const { cookie } = await criarDiretorComCookie(escolaA);

            const res = await request(app).get('/api/avaliacoes-escolares').set('Cookie', cookie);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
        });

        it('deve permitir acesso para secretaria', async () => {
            const { cookie } = await criarSecretariaComCookie(escolaA);

            const res = await request(app).get('/api/avaliacoes-escolares').set('Cookie', cookie);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('deve permitir acesso para professor', async () => {
            const { cookie } = await criarProfessorComCookie(escolaA, ['7A']);

            const res = await request(app).get('/api/avaliacoes-escolares').set('Cookie', cookie);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('2. CRUD de Avaliações', () => {
        it('deve validar campos obrigatórios na criação (POST 400)', async () => {
            const { cookie } = await criarDiretorComCookie(escolaA);

            const res = await request(app)
                .post('/api/avaliacoes-escolares')
                .set('Cookie', cookie)
                .send({
                    titulo: '',
                    turmaId: '7A',
                });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toMatch(/obrigatórios/i);
        });

        it('diretor cria avaliação com sucesso (POST 201)', async () => {
            const { cookie } = await criarDiretorComCookie(escolaA);

            const payload = {
                titulo: 'Prova 1 - Álgebra Linear',
                descricao: 'Capítulos 1 e 2',
                turmaId: '7A',
                materiaId: 'Matemática',
                bimestre: 1,
                tipo: 'Prova',
                peso: 2,
                data: '2026-03-20',
            };

            const res = await request(app)
                .post('/api/avaliacoes-escolares')
                .set('Cookie', cookie)
                .send(payload);

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.titulo).toBe('Prova 1 - Álgebra Linear');
            expect(res.body.data.peso).toBe(2);
            expect(res.body.data.turmaId).toBe('7A');
            expect(res.body.data.bimestre).toBe(1);

            // Verifica no banco
            const noBanco = await Avaliacao.findById(res.body.data._id);
            expect(noBanco).not.toBeNull();
            expect(noBanco.materiaId).toBe('Matemática');
        });

        it('professor só pode criar avaliação para turmas que leciona', async () => {
            const { cookie } = await criarProfessorComCookie(escolaA, ['7A']);

            // Tentativa para 8B (turma não atribuída) -> 403
            const resProibido = await request(app)
                .post('/api/avaliacoes-escolares')
                .set('Cookie', cookie)
                .send({
                    titulo: 'Atividade 8B',
                    turmaId: '8B',
                    materiaId: 'História',
                    bimestre: 2,
                });

            expect(resProibido.status).toBe(403);
            expect(resProibido.body.error).toMatch(/não leciona/i);

            // Tentativa para 7A (sua turma) -> 201
            const resPermitido = await request(app)
                .post('/api/avaliacoes-escolares')
                .set('Cookie', cookie)
                .send({
                    titulo: 'Atividade 7A',
                    turmaId: '7A',
                    materiaId: 'História',
                    bimestre: 2,
                });

            expect(resPermitido.status).toBe(201);
            expect(resPermitido.body.success).toBe(true);
        });

        it('deve listar avaliações com filtros e limitar escopo do professor', async () => {
            const { cookie: cookieDir } = await criarDiretorComCookie(escolaA);
            const { cookie: cookieProf } = await criarProfessorComCookie(escolaA, ['7A']);

            // Cria avaliação na 7A e outra na 8B
            await Avaliacao.create({
                titulo: 'Avaliação 7A',
                turmaId: '7A',
                materiaId: 'Matemática',
                bimestre: 1,
                escolaId: String(escolaA._id),
            });
            await Avaliacao.create({
                titulo: 'Avaliação 8B',
                turmaId: '8B',
                materiaId: 'Geografia',
                bimestre: 1,
                escolaId: String(escolaA._id),
            });

            // Diretor enxerga ambas
            const resDir = await request(app)
                .get('/api/avaliacoes-escolares')
                .set('Cookie', cookieDir);
            expect(resDir.body.data.length).toBe(2);

            // Professor de 7A só enxerga a da 7A
            const resProf = await request(app)
                .get('/api/avaliacoes-escolares')
                .set('Cookie', cookieProf);
            expect(resProf.body.data.length).toBe(1);
            expect(resProf.body.data[0].turmaId).toBe('7A');

            // Professor tentando filtrar explicitamente por 8B toma 403
            const resProf8B = await request(app)
                .get('/api/avaliacoes-escolares?turmaId=8B')
                .set('Cookie', cookieProf);
            expect(resProf8B.status).toBe(403);
        });

        it('GET /:id deve retornar 404 para ID inexistente', async () => {
            const { cookie } = await criarDiretorComCookie(escolaA);
            const fakeId = new mongoose.Types.ObjectId();

            const res = await request(app)
                .get(`/api/avaliacoes-escolares/${fakeId}`)
                .set('Cookie', cookie);

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });

        it('PUT /:id deve atualizar avaliação existente', async () => {
            const { cookie } = await criarDiretorComCookie(escolaA);

            const avaliacao = await Avaliacao.create({
                titulo: 'Título Velho',
                turmaId: '7A',
                materiaId: 'Ciências',
                bimestre: 1,
                peso: 1,
                escolaId: String(escolaA._id),
            });

            const res = await request(app)
                .put(`/api/avaliacoes-escolares/${avaliacao._id}`)
                .set('Cookie', cookie)
                .send({
                    titulo: 'Título Atualizado',
                    peso: 3.5,
                });

            expect(res.status).toBe(200);
            expect(res.body.data.titulo).toBe('Título Atualizado');
            expect(res.body.data.peso).toBe(3.5);
        });

        it('DELETE /:id deve remover avaliação e notas associadas', async () => {
            const { cookie } = await criarDiretorComCookie(escolaA);

            const avaliacao = await Avaliacao.create({
                titulo: 'A ser deletada',
                turmaId: '7A',
                materiaId: 'Artes',
                bimestre: 1,
                escolaId: String(escolaA._id),
            });

            await Nota.create({
                avaliacaoId: String(avaliacao._id),
                alunoId: 'aluno-1',
                turmaId: '7A',
                nota: 8.5,
                escolaId: String(escolaA._id),
            });

            const res = await request(app)
                .delete(`/api/avaliacoes-escolares/${avaliacao._id}`)
                .set('Cookie', cookie);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            // Confirma exclusão
            const avalNoBanco = await Avaliacao.findById(avaliacao._id);
            expect(avalNoBanco).toBeNull();

            const notasNoBanco = await Nota.find({ avaliacaoId: String(avaliacao._id) });
            expect(notasNoBanco.length).toBe(0);
        });
    });

    describe('3. Lançamento de Notas, Cálculos Pedagógicos e Métricas', () => {
        it('deve validar notas no intervalo 0 a 10', async () => {
            const { cookie } = await criarDiretorComCookie(escolaA);

            const avaliacao = await Avaliacao.create({
                titulo: 'Teste Validação',
                turmaId: '7A',
                materiaId: 'Português',
                bimestre: 1,
                escolaId: String(escolaA._id),
            });

            const res = await request(app)
                .post(`/api/avaliacoes-escolares/${avaliacao._id}/notas`)
                .set('Cookie', cookie)
                .send({
                    notas: [{ alunoId: 'aluno-fake', nota: 15 }], // inválida
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/entre 0 e 10/i);
        });

        it('deve lançar notas em lote e calcular status pedagógico correto', async () => {
            const { cookie } = await criarDiretorComCookie(escolaA);

            const aluno1 = await Aluno.create({
                nome: 'Ana Aprovada',
                matricula: '2026-001',
                turmaId: '7A',
                ativo: true,
                escolaId: String(escolaA._id),
            });
            const aluno2 = await Aluno.create({
                nome: 'Bruno Recuperação',
                matricula: '2026-002',
                turmaId: '7A',
                ativo: true,
                escolaId: String(escolaA._id),
            });
            const aluno3 = await Aluno.create({
                nome: 'Carlos Reprovado',
                matricula: '2026-003',
                turmaId: '7A',
                ativo: true,
                escolaId: String(escolaA._id),
            });
            const aluno4 = await Aluno.create({
                nome: 'Daniel Ausente',
                matricula: '2026-004',
                turmaId: '7A',
                ativo: true,
                escolaId: String(escolaA._id),
            });

            const avaliacao = await Avaliacao.create({
                titulo: 'Simulado Geral',
                turmaId: '7A',
                materiaId: 'Geral',
                bimestre: 1,
                escolaId: String(escolaA._id),
            });

            const res = await request(app)
                .post(`/api/avaliacoes-escolares/${avaliacao._id}/notas`)
                .set('Cookie', cookie)
                .send({
                    notas: [
                        {
                            alunoId: String(aluno1._id),
                            nota: 8.5,
                            presente: true,
                            observacoes: 'Ótimo trabalho',
                        },
                        { alunoId: String(aluno2._id), nota: 5.0, presente: true },
                        { alunoId: String(aluno3._id), nota: 2.5, presente: true },
                        {
                            alunoId: String(aluno4._id),
                            nota: null,
                            presente: false,
                            observacoes: 'Faltou com atestado',
                        },
                    ],
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.processados).toBe(4);

            // Consulta os detalhes com métricas em GET /:id
            const resGet = await request(app)
                .get(`/api/avaliacoes-escolares/${avaliacao._id}`)
                .set('Cookie', cookie);

            expect(resGet.status).toBe(200);
            const { data } = resGet.body;

            expect(data.alunos.length).toBe(4);
            const statusMap = {};
            data.alunos.forEach((a) => {
                statusMap[a.alunoNome] = a.status;
            });

            expect(statusMap['Ana Aprovada']).toBe('Aprovado');
            expect(statusMap['Bruno Recuperação']).toBe('Recuperação');
            expect(statusMap['Carlos Reprovado']).toBe('Reprovado');
            expect(statusMap['Daniel Ausente']).toBe('Reprovado'); // ausente conta reprovado

            // Checagem das métricas da turma
            expect(data.metricas.totalAlunos).toBe(4);
            expect(data.metricas.avaliados).toBe(4);
            expect(data.metricas.aprovados).toBe(1);
            expect(data.metricas.recuperacao).toBe(1);
            expect(data.metricas.reprovados).toBe(2);
            expect(data.metricas.maiorNota).toBe(8.5);
            expect(data.metricas.menorNota).toBe(2.5);
            // Média dos presentes: (8.5 + 5.0 + 2.5) / 3 = 5.33 -> 5.3
            expect(data.metricas.mediaTurma).toBe(5.3);
            // Taxa de aprovação: 1 / 4 = 25%
            expect(data.metricas.taxaAprovacao).toBe(25);
        });
    });

    describe('4. Trilha de Auditoria e Histórico de Alterações', () => {
        it('deve registrar histórico quando a nota de um aluno for alterada', async () => {
            const { cookie, user } = await criarDiretorComCookie(escolaA);

            const aluno = await Aluno.create({
                nome: 'Mariana Silva',
                matricula: '2026-100',
                turmaId: '7A',
                ativo: true,
                escolaId: String(escolaA._id),
            });

            const avaliacao = await Avaliacao.create({
                titulo: 'Redação Mensal',
                turmaId: '7A',
                materiaId: 'Português',
                bimestre: 1,
                escolaId: String(escolaA._id),
            });

            // 1º lançamento: nota 6.0
            await request(app)
                .post(`/api/avaliacoes-escolares/${avaliacao._id}/notas`)
                .set('Cookie', cookie)
                .send({
                    notas: [{ alunoId: String(aluno._id), nota: 6.0, presente: true }],
                });

            // Não deve haver histórico ainda (foi inserção inicial)
            let resHist = await request(app)
                .get(`/api/avaliacoes-escolares/${avaliacao._id}/historico`)
                .set('Cookie', cookie);
            expect(resHist.body.data.length).toBe(0);

            // 2º lançamento: alteração para 9.0 com justificativa
            const resUpdate = await request(app)
                .post(`/api/avaliacoes-escolares/${avaliacao._id}/notas`)
                .set('Cookie', cookie)
                .send({
                    motivo: 'Revisão pedagógica de critérios textuais',
                    notas: [{ alunoId: String(aluno._id), nota: 9.0, presente: true }],
                });

            expect(resUpdate.status).toBe(200);
            expect(resUpdate.body.alteracoesAuditoria).toBe(1);

            // Consulta o histórico
            resHist = await request(app)
                .get(`/api/avaliacoes-escolares/${avaliacao._id}/historico`)
                .set('Cookie', cookie);

            expect(resHist.status).toBe(200);
            expect(resHist.body.data.length).toBe(1);

            const auditItem = resHist.body.data[0];
            expect(auditItem.alunoNome).toBe('Mariana Silva');
            expect(auditItem.notaAnterior).toBe(6.0);
            expect(auditItem.notaNova).toBe(9.0);
            expect(auditItem.motivo).toBe('Revisão pedagógica de critérios textuais');
            expect(auditItem.alteradoPorNome).toBe(user.nome);
            expect(auditItem.alteradoPorPerfil).toBe('diretor');

            // Valida persistência direta no banco
            const auditDocs = await AvaliacaoHistorico.find({ avaliacaoId: String(avaliacao._id) });
            expect(auditDocs.length).toBe(1);
        });
    });

    describe('5. Isolamento Multi-Escola (Tenant Isolation)', () => {
        it('avaliação de outra escola não deve ser listada nem acessada por ID', async () => {
            const { cookie: cookieA } = await criarDiretorComCookie(escolaA);

            // Cria avaliação na Escola B
            const avaliacaoB = await Avaliacao.create({
                titulo: 'Avaliação Sigilosa Escola B',
                turmaId: '9A',
                materiaId: 'Física',
                bimestre: 1,
                escolaId: String(escolaB._id),
            });

            // Diretor da Escola A não vê a avaliação da Escola B na listagem
            const resListA = await request(app)
                .get('/api/avaliacoes-escolares')
                .set('Cookie', cookieA);
            const achouNaLista = resListA.body.data.some(
                (a) => String(a._id) === String(avaliacaoB._id)
            );
            expect(achouNaLista).toBe(false);

            // Diretor da Escola A não consegue buscar por ID direto da avaliação da Escola B (404)
            const resGetA = await request(app)
                .get(`/api/avaliacoes-escolares/${avaliacaoB._id}`)
                .set('Cookie', cookieA);
            expect(resGetA.status).toBe(404);
        });
    });
});
