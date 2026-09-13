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
const Turma = require('../models/Turma');
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
            await Turma.create({ id: '7A', nome: '7A', escolaId: String(escolaA._id) });

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
                    data: '2026-04-10',
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
                    data: '2026-04-10',
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

    describe('6. Turmas e disciplinas reais no formulário (GET /opcoes)', () => {
        const idsDas = (res) => res.body.data.turmas.map((t) => t.id);

        it('junta as grafias do banco numa turma só, agrupada por série', async () => {
            const { cookie } = await criarDiretorComCookie(escolaA);
            const escolaId = String(escolaA._id);

            // Três grafias de sala convivendo no banco, como na produção.
            await Turma.create([
                { id: '1A', nome: '1º Ano A', escolaId },
                { nome: '1ºB', escolaId },
                { id: '5D', nome: '5D', escolaId },
                { id: '4B', nome: '4B', escolaId, ativo: false },
                { id: '9Z', nome: '9Z', escolaId: String(escolaB._id) },
            ]);
            // Sala que só existe porque tem aluno matriculado nela.
            await Aluno.create({ nome: 'Aluno 2C', turma: '2ºC', ativo: true, escolaId });
            // Turma desativada não volta pelo aluno que ainda aponta para ela.
            await Aluno.create({ nome: 'Aluno 4B', turma: '4B', ativo: true, escolaId });
            await criarProfessorComCookie(escolaA, ['3A']);

            const res = await request(app)
                .get('/api/avaliacoes-escolares/opcoes')
                .set('Cookie', cookie);

            expect(res.status).toBe(200);
            expect(idsDas(res)).toEqual(['1A', '1B', '2C', '3A', '5D']);
            expect(res.body.data.turmas[0].nome).toBe('1ºA');
            expect(res.body.data.series.map((s) => s.nome)).toEqual([
                '1º Ano',
                '2º Ano',
                '3º Ano',
                '5º Ano',
            ]);
            expect(res.body.data.series[0].turmas.map((t) => t.nome)).toEqual(['1ºA', '1ºB']);
        });

        it('oferece os componentes obrigatórios e só mostra Inglês quando cadastrado', async () => {
            const { cookie } = await criarDiretorComCookie(escolaA);

            const semIngles = await request(app)
                .get('/api/avaliacoes-escolares/opcoes')
                .set('Cookie', cookie);
            const nomes = semIngles.body.data.disciplinas.map((d) => d.nome);
            expect(nomes).toEqual([
                'Língua Portuguesa',
                'Matemática',
                'Ciências',
                'História',
                'Geografia',
                'Arte',
                'Educação Física',
                'Ensino Religioso',
            ]);

            // Professor de Inglês da escola, com "Geral" (marca de regente) de sujeira.
            await Professor.create({
                idUsuario: new mongoose.Types.ObjectId().toString(),
                nome: 'Prof. Inglês',
                materias: ['Inglês', 'Geral'],
                tipoEspecial: true,
                salaPrincipal: 'VARIADOS',
                salasAdicionais: ['1A'],
                vinculos: [{ escolaId: String(escolaA._id), cargo: 'professor' }],
            });

            const comIngles = await request(app)
                .get('/api/avaliacoes-escolares/opcoes')
                .set('Cookie', cookie);
            const nomesDepois = comIngles.body.data.disciplinas.map((d) => d.nome);
            expect(nomesDepois).toContain('Inglês');
            expect(nomesDepois).not.toContain('Geral');
            expect(nomesDepois.filter((n) => n === 'Inglês')).toHaveLength(1);
        });

        it('professor recebe só as turmas dele; especialista, só a disciplina dele', async () => {
            const { cookie: cookieRegente } = await criarProfessorComCookie(escolaA, ['2ºB']);
            const regente = await request(app)
                .get('/api/avaliacoes-escolares/opcoes')
                .set('Cookie', cookieRegente);
            expect(idsDas(regente)).toEqual(['2B']);
            expect(regente.body.data.disciplinas.length).toBeGreaterThanOrEqual(8);

            const user = await criarUsuario({
                perfil: 'professor',
                nome: 'Prof. Ed. Física',
                email: `edf_${Date.now()}@escola.test`,
                escolaId: String(escolaA._id),
            });
            await Professor.create({
                idUsuario: String(user._id),
                nome: user.nome,
                email: user.email,
                materias: ['Ed. Física'],
                tipoEspecial: true,
                salaPrincipal: 'VARIADOS',
                salasAdicionais: ['1A', '1B'],
                turmas: ['1A', '1B'],
                vinculos: [{ escolaId: String(escolaA._id), cargo: 'professor' }],
            });
            const especialista = await request(app)
                .get('/api/avaliacoes-escolares/opcoes')
                .set('Cookie', gerarCookieAuth(user));
            expect(idsDas(especialista)).toEqual(['1A', '1B']);
            expect(especialista.body.data.disciplinas.map((d) => d.nome)).toEqual([
                'Educação Física',
            ]);

            // E o servidor segura a mesma regra, não só o formulário.
            const outraDisciplina = await request(app)
                .post('/api/avaliacoes-escolares')
                .set('Cookie', gerarCookieAuth(user))
                .send({
                    titulo: 'Prova de Matemática',
                    turmaId: '1A',
                    materiaId: 'Matemática',
                    bimestre: 1,
                    data: '2026-05-04',
                });
            expect(outraDisciplina.status).toBe(403);
        });

        it('responsável (família) não acessa as opções', async () => {
            const resp = await criarUsuario({
                perfil: 'responsavel',
                email: `resp_op_${Date.now()}@escola.test`,
                escolaId: String(escolaA._id),
            });
            const res = await request(app)
                .get('/api/avaliacoes-escolares/opcoes')
                .set('Cookie', gerarCookieAuth(resp));
            expect(res.status).toBe(403);
        });
    });

    describe('7. Nova Avaliação grava tudo no banco', () => {
        async function prepararEscola() {
            const escolaId = String(escolaA._id);
            await Turma.create([
                { id: '1A', nome: '1A', escolaId },
                { id: '5D', nome: '5D', escolaId },
            ]);
            const regente = await criarProfessorComCookie(escolaA, ['1A']);
            return { escolaId, regente };
        }

        it('grava turma canônica, série, disciplina, valor, datas, professor e autor', async () => {
            const { regente } = await prepararEscola();
            const { cookie, user } = await criarSecretariaComCookie(escolaA);

            const res = await request(app)
                .post('/api/avaliacoes-escolares')
                .set('Cookie', cookie)
                .send({
                    titulo: 'Leitura e interpretação',
                    descricao: 'Texto narrativo, questões 1 a 5',
                    turmaId: '1ºA',
                    materiaId: 'Português',
                    bimestre: 2,
                    tipo: 'Prova',
                    valor: '8,5',
                    data: '2026-05-04',
                    dataEntrega: '2026-05-11',
                });

            expect(res.status).toBe(201);
            const doc = await Avaliacao.findById(res.body.data._id).lean();
            expect(doc).toMatchObject({
                turmaId: '1A',
                turmaNome: '1ºA',
                serie: 1,
                materiaId: 'Língua Portuguesa',
                materiaNome: 'Língua Portuguesa',
                professorId: String(regente.user._id),
                professorNome: regente.user.nome,
                titulo: 'Leitura e interpretação',
                descricao: 'Texto narrativo, questões 1 a 5',
                valor: 8.5,
                criadoPor: String(user._id),
                criadoPorNome: user.nome,
                criadoPorPerfil: 'secretaria',
                escolaId: String(escolaA._id),
            });
            // Meio-dia UTC: continua sendo dia 4 no horário de Brasília.
            expect(doc.data.toISOString()).toBe('2026-05-04T12:00:00.000Z');
            expect(doc.dataEntrega.toISOString()).toBe('2026-05-11T12:00:00.000Z');
            expect(doc.createdAt).toBeInstanceOf(Date);
        });

        it('diretor escolhe o professor responsável', async () => {
            await prepararEscola();
            const outro = await criarProfessorComCookie(escolaA, ['5D']);
            const { cookie } = await criarDiretorComCookie(escolaA);

            const res = await request(app)
                .post('/api/avaliacoes-escolares')
                .set('Cookie', cookie)
                .send({
                    titulo: 'Simulado',
                    turmaId: '1A',
                    materiaId: 'Matemática',
                    bimestre: 1,
                    data: '2026-05-04',
                    professorId: String(outro.user._id),
                });
            expect(res.status).toBe(201);
            expect(res.body.data.professorId).toBe(String(outro.user._id));

            const estranho = await request(app)
                .post('/api/avaliacoes-escolares')
                .set('Cookie', cookie)
                .send({
                    titulo: 'Simulado',
                    turmaId: '1A',
                    materiaId: 'Matemática',
                    bimestre: 1,
                    data: '2026-05-04',
                    professorId: new mongoose.Types.ObjectId().toString(),
                });
            expect(estranho.status).toBe(400);
        });

        it.each([
            ['turma que a escola não tem', { turmaId: '3C' }, /não está cadastrada/],
            ['texto que não é turma', { turmaId: 'Turma X' }, /Turma inválida/],
            ['disciplina inexistente', { materiaId: 'Astronomia Avançada' }, /Disciplina/],
            ['valor acima de 10', { valor: 12 }, /valor da avaliação/],
            ['entrega antes da avaliação', { dataEntrega: '2026-05-01' }, /entrega/],
            ['sem data', { data: '' }, /Data da avaliação/],
        ])('recusa %s (400)', async (_caso, troca, mensagem) => {
            await prepararEscola();
            const { cookie } = await criarDiretorComCookie(escolaA);
            const res = await request(app)
                .post('/api/avaliacoes-escolares')
                .set('Cookie', cookie)
                .send({
                    titulo: 'Avaliação',
                    turmaId: '1A',
                    materiaId: 'Matemática',
                    bimestre: 1,
                    data: '2026-05-04',
                    ...troca,
                });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(mensagem);
            expect(await Avaliacao.countDocuments()).toBe(0);
        });

        it('nota respeita o valor da avaliação e o status usa a proporção', async () => {
            const { escolaId } = await prepararEscola();
            const { cookie } = await criarDiretorComCookie(escolaA);
            // Aluno gravado com a outra grafia da mesma sala.
            const aluno = await Aluno.create({ nome: 'Bia', turma: '1ºA', ativo: true, escolaId });

            const criada = await request(app)
                .post('/api/avaliacoes-escolares')
                .set('Cookie', cookie)
                .send({
                    titulo: 'Trabalho',
                    turmaId: '1A',
                    materiaId: 'Ciências',
                    bimestre: 1,
                    data: '2026-05-04',
                    valor: 5,
                });
            const id = criada.body.data._id;

            const acima = await request(app)
                .post(`/api/avaliacoes-escolares/${id}/notas`)
                .set('Cookie', cookie)
                .send({ notas: [{ alunoId: String(aluno._id), nota: 6 }] });
            expect(acima.status).toBe(400);
            expect(acima.body.error).toMatch(/entre 0 e 5/);

            const pendente = await Aluno.create({
                nome: 'Caio',
                turma: '1A',
                ativo: true,
                escolaId,
            });
            await request(app)
                .post(`/api/avaliacoes-escolares/${id}/notas`)
                .set('Cookie', cookie)
                .send({
                    notas: [
                        { alunoId: String(aluno._id), nota: 4 },
                        { alunoId: String(pendente._id), nota: null },
                    ],
                });

            const detalhe = await request(app)
                .get(`/api/avaliacoes-escolares/${id}`)
                .set('Cookie', cookie);
            expect(detalhe.body.data.alunos).toHaveLength(2);
            const bia = detalhe.body.data.alunos.find((a) => a.alunoNome === 'Bia');
            expect(bia.status).toBe('Aprovado'); // 4 de 5 = 8,0

            // Na lista, o aluno sem nota não conta como nota lançada.
            const lista = await request(app).get('/api/avaliacoes-escolares').set('Cookie', cookie);
            expect(lista.body.data[0]).toMatchObject({
                totalNotas: 1,
                totalAprovados: 1,
                mediaTurma: 4,
                valor: 5,
            });
        });

        it('professor não lê o histórico de avaliação de outra turma', async () => {
            await prepararEscola();
            const { cookie: cookieDir } = await criarDiretorComCookie(escolaA);
            const criada = await request(app)
                .post('/api/avaliacoes-escolares')
                .set('Cookie', cookieDir)
                .send({
                    titulo: 'Prova 5D',
                    turmaId: '5D',
                    materiaId: 'História',
                    bimestre: 1,
                    data: '2026-05-04',
                });

            const { cookie: cookieProf } = await criarProfessorComCookie(escolaA, ['1A']);
            const res = await request(app)
                .get(`/api/avaliacoes-escolares/${criada.body.data._id}/historico`)
                .set('Cookie', cookieProf);
            expect(res.status).toBe(403);
        });

        it('filtro por disciplina acha também a grafia antiga gravada', async () => {
            const { escolaId } = await prepararEscola();
            const { cookie } = await criarDiretorComCookie(escolaA);
            // Gravada antes da grafia canônica, com o nome informal.
            await Avaliacao.create({
                titulo: 'Antiga',
                turmaId: '1ºA',
                materiaId: 'Português',
                bimestre: 1,
                escolaId,
            });
            await request(app).post('/api/avaliacoes-escolares').set('Cookie', cookie).send({
                titulo: 'Nova',
                turmaId: '1A',
                materiaId: 'Língua Portuguesa',
                bimestre: 1,
                data: '2026-05-04',
            });
            await request(app).post('/api/avaliacoes-escolares').set('Cookie', cookie).send({
                titulo: 'De outra disciplina',
                turmaId: '1A',
                materiaId: 'Matemática',
                bimestre: 1,
                data: '2026-05-04',
            });

            const res = await request(app)
                .get(
                    `/api/avaliacoes-escolares?materiaId=${encodeURIComponent('Língua Portuguesa')}`
                )
                .set('Cookie', cookie);
            const porTitulo = Object.fromEntries(res.body.data.map((a) => [a.titulo, a]));
            expect(Object.keys(porTitulo).sort()).toEqual(['Antiga', 'Nova']);
            expect(porTitulo.Antiga.materiaNome).toBe('Língua Portuguesa');
            expect(porTitulo.Antiga.turmaNome).toBe('1ºA');

            // E o filtro de turma acha a grafia antiga "1ºA" pelo id canônico.
            const porTurma = await request(app)
                .get('/api/avaliacoes-escolares?turmaId=1A')
                .set('Cookie', cookie);
            expect(porTurma.body.data).toHaveLength(3);
        });

        it('lista marca o que cada perfil pode gerenciar', async () => {
            await prepararEscola();
            const prof = await criarProfessorComCookie(escolaA, ['1A']);
            const { cookie: cookieDir } = await criarDiretorComCookie(escolaA);

            await request(app)
                .post('/api/avaliacoes-escolares')
                .set('Cookie', cookieDir)
                .send({
                    titulo: 'Da direção',
                    turmaId: '1A',
                    materiaId: 'Geografia',
                    bimestre: 1,
                    data: '2026-05-04',
                    professorId: String(prof.user._id),
                });
            await request(app).post('/api/avaliacoes-escolares').set('Cookie', prof.cookie).send({
                titulo: 'Do professor',
                turmaId: '1A',
                materiaId: 'Arte',
                bimestre: 1,
                data: '2026-05-05',
            });

            const visao = await request(app)
                .get('/api/avaliacoes-escolares')
                .set('Cookie', prof.cookie);
            const porTitulo = Object.fromEntries(
                visao.body.data.map((a) => [a.titulo, a.podeGerenciar])
            );
            expect(porTitulo['Do professor']).toBe(true);
            // A direção atribuiu a avaliação a ele: passa a ser dele também.
            expect(porTitulo['Da direção']).toBe(true);

            const outroProf = await criarProfessorComCookie(escolaA, ['1A', '5D']);
            const visaoOutro = await request(app)
                .get('/api/avaliacoes-escolares')
                .set('Cookie', outroProf.cookie);
            expect(visaoOutro.body.data.every((a) => a.podeGerenciar === false)).toBe(true);
        });
    });
});
