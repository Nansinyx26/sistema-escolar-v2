/**
 * secretariaAutorizacoes.test.js
 * ============================================================================
 * Suite de testes da página e endpoints de Autorizações dos Alunos.
 *
 * Garante:
 * 1. RBAC estrito (Secretaria, Diretor e Admin têm acesso; Professor e anônimo bloqueados)
 * 2. Multi-tenancy (isolamento por escolaId — nenhuma escola vê dados de outra)
 * 3. Cálculo de KPIs e consolidação de status em tempo real
 * 4. Detalhamento individual das 7 autorizações escolares com descrições
 * 5. Fallback retroativo com Aluno.autorizacoesEscolares
 * 6. Sincronização em tempo real via ResponsavelController.updateAlunoDados
 */

const request = require('supertest');
const app = require('../app');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

const Aluno = require('../models/Aluno');
const Autorizacao = require('../models/Autorizacao');
const Escola = require('../models/Escola');
const Secretaria = require('../models/Secretaria');
const Diretor = require('../models/Diretor');
const Professor = require('../models/Professor');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

let ESCOLA_A;
let ESCOLA_B;

async function criarAmbienteEscola(nome) {
    const escola = await Escola.create({
        nome: nome || `Escola ${Date.now()}`,
        tipo: 'EMEF',
        ativo: true,
    });
    invalidarCacheEscolas();
    return String(escola._id);
}

async function sessaoUsuario(perfil, escolaId) {
    const usuario = await criarUsuario({
        email: `${perfil}_${Date.now()}_${Math.random().toString(36).substring(7)}@escola.test`,
        nome: `Usuário ${perfil}`,
        perfil,
        escolaId,
    });

    if (perfil === 'secretaria') {
        await Secretaria.create({
            idUsuario: String(usuario._id),
            nome: usuario.nome,
            email: usuario.email,
            vinculos: [{ escolaId, cargo: 'secretaria' }],
        });
    } else if (perfil === 'diretor') {
        await Diretor.create({
            idUsuario: String(usuario._id),
            nome: usuario.nome,
            email: usuario.email,
            vinculos: [{ escolaId, cargo: 'diretor' }],
        });
    } else if (perfil === 'professor') {
        await Professor.create({
            idUsuario: String(usuario._id),
            nome: usuario.nome,
            email: usuario.email,
            vinculos: [{ escolaId, cargo: 'professor' }],
        });
    }

    return {
        usuario,
        cookies: [`escola_jwt=${assinarTokenSessao(usuario, { escolaId })}`],
    };
}

describe('Autorizações dos Alunos — /api/secretaria/autorizacoes', () => {
    beforeAll(async () => {
        await conectarBanco();
    });

    afterAll(async () => {
        await desconectarBanco();
    });

    beforeEach(async () => {
        await limparBanco();
        invalidarCacheEscolas();
        ESCOLA_A = await criarAmbienteEscola('Escola Alpha');
        ESCOLA_B = await criarAmbienteEscola('Escola Beta');
    });

    // ── 1. RBAC: Controle de Acesso ──────────────────────────────────────────
    describe('Controle de Acesso (RBAC)', () => {
        it('deve retornar 401 para requisições não autenticadas', async () => {
            const res = await request(app).get('/api/secretaria/autorizacoes');
            expect(res.status).toBe(401);
        });

        it('deve retornar 403 para perfil Professor', async () => {
            const { cookies } = await sessaoUsuario('professor', ESCOLA_A);
            const res = await request(app)
                .get('/api/secretaria/autorizacoes')
                .set('Cookie', cookies);
            expect(res.status).toBe(403);
        });

        it('deve retornar 200 para perfil Secretaria', async () => {
            const { cookies } = await sessaoUsuario('secretaria', ESCOLA_A);
            const res = await request(app)
                .get('/api/secretaria/autorizacoes')
                .set('Cookie', cookies);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('deve retornar 200 para perfil Diretor', async () => {
            const { cookies } = await sessaoUsuario('diretor', ESCOLA_A);
            const res = await request(app)
                .get('/api/secretaria/autorizacoes')
                .set('Cookie', cookies);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('deve retornar 200 para perfil Admin', async () => {
            const { cookies } = await sessaoUsuario('admin', ESCOLA_A);
            const res = await request(app)
                .get('/api/secretaria/autorizacoes')
                .set('Cookie', cookies);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    // ── 2. Multi-tenancy: Isolamento entre Escolas ───────────────────────────
    describe('Multi-tenancy (Isolamento por Escola)', () => {
        it('não deve vazar alunos ou autorizações de outra escola', async () => {
            // Cria aluno na Escola A
            await Aluno.create({
                nome: 'Aluno da Escola A',
                escolaId: ESCOLA_A,
                turma: '5º Ano A',
                responsavel: 'Pai Alpha',
                autorizacoesEscolares: {
                    tratamentoOdontologico: true,
                    tratamentoMedicoEmergencial: true,
                },
            });

            // Cria aluno na Escola B
            await Aluno.create({
                nome: 'Aluno da Escola B',
                escolaId: ESCOLA_B,
                turma: '6º Ano B',
                responsavel: 'Mãe Beta',
                autorizacoesEscolares: {
                    tratamentoOdontologico: false,
                },
            });

            const { cookies: cookiesA } = await sessaoUsuario('secretaria', ESCOLA_A);
            const resA = await request(app)
                .get('/api/secretaria/autorizacoes')
                .set('Cookie', cookiesA);

            expect(resA.status).toBe(200);
            expect(resA.body.kpis.totalAlunos).toBe(1);
            expect(resA.body.alunos).toHaveLength(1);
            expect(resA.body.alunos[0].nome).toBe('Aluno da Escola A');
            expect(resA.body.turmas).toEqual(['5º Ano A']);

            const { cookies: cookiesB } = await sessaoUsuario('secretaria', ESCOLA_B);
            const resB = await request(app)
                .get('/api/secretaria/autorizacoes')
                .set('Cookie', cookiesB);

            expect(resB.status).toBe(200);
            expect(resB.body.kpis.totalAlunos).toBe(1);
            expect(resB.body.alunos).toHaveLength(1);
            expect(resB.body.alunos[0].nome).toBe('Aluno da Escola B');
            expect(resB.body.turmas).toEqual(['6º Ano B']);
        });
    });

    // ── 3. Consolidação de KPIs e Status ────────────────────────────────────
    describe('Cálculo de KPIs e Status Geral', () => {
        it('deve calcular corretamente aceitas, não aceitas, pendentes e taxa de aceitação', async () => {
            // Aluno 1: Todas as 7 autorizações aceitas
            await Aluno.create({
                nome: 'Aluno 100% Aceito',
                escolaId: ESCOLA_A,
                turma: '1º Ano A',
                responsavel: 'Maria Responsável',
                autorizacoesEscolares: {
                    tratamentoOdontologico: true,
                    tratamentoMedicoEmergencial: true,
                    testagemAcuidade: true,
                    atividadesFisicas: true,
                    atividadesExtraclasse: true,
                    conducaoEscolar: true,
                    antitermico: true,
                },
            });

            // Aluno 2: 2 aceitas, 1 não aceita, 4 pendentes
            await Aluno.create({
                nome: 'Aluno Parcial com Recusa',
                escolaId: ESCOLA_A,
                turma: '2º Ano B',
                responsavel: 'José Responsável',
                autorizacoesEscolares: {
                    tratamentoOdontologico: true,
                    tratamentoMedicoEmergencial: false,
                    testagemAcuidade: true,
                },
            });

            // Aluno 3: Nenhuma autorização respondida
            await Aluno.create({
                nome: 'Aluno Sem Respostas',
                escolaId: ESCOLA_A,
                turma: '1º Ano A',
                responsavel: 'Carlos Responsável',
            });

            const { cookies } = await sessaoUsuario('secretaria', ESCOLA_A);
            const res = await request(app)
                .get('/api/secretaria/autorizacoes')
                .set('Cookie', cookies);

            expect(res.status).toBe(200);
            const { kpis, alunos } = res.body;

            expect(kpis.totalAlunos).toBe(3);
            expect(kpis.totalAceitas).toBe(7 + 2); // 9
            expect(kpis.totalNaoAceitas).toBe(1); // 1
            expect(kpis.totalPendentes).toBe(2); // Aluno 2 (tem 4 pendentes) e Aluno 3 (todas pendentes)

            // Taxa: 9 aceitas / 10 respondidas = 90%
            expect(kpis.percentualAceitacao).toBe(90);

            const a1 = alunos.find((a) => a.nome === 'Aluno 100% Aceito');
            expect(a1.statusGeral).toBe('todas_aceitas');
            expect(a1.aceitas).toBe(7);
            expect(a1.naoAceitas).toBe(0);

            const a2 = alunos.find((a) => a.nome === 'Aluno Parcial com Recusa');
            expect(a2.statusGeral).toBe('com_recusas');
            expect(a2.aceitas).toBe(2);
            expect(a2.naoAceitas).toBe(1);

            const a3 = alunos.find((a) => a.nome === 'Aluno Sem Respostas');
            expect(a3.statusGeral).toBe('pendente');
            expect(a3.aceitas).toBe(0);
            expect(a3.naoAceitas).toBe(0);
        });
    });

    // ── 4. Detalhamento Individual ──────────────────────────────────────────
    describe('GET /api/secretaria/autorizacoes/aluno/:id', () => {
        it('deve retornar 404 quando o aluno não pertence à escola', async () => {
            const alunoB = await Aluno.create({
                nome: 'Aluno de Outra Escola',
                escolaId: ESCOLA_B,
                turma: '3º Ano',
            });

            const { cookies } = await sessaoUsuario('secretaria', ESCOLA_A);
            const res = await request(app)
                .get(`/api/secretaria/autorizacoes/aluno/${alunoB._id}`)
                .set('Cookie', cookies);

            expect(res.status).toBe(404);
        });

        it('deve detalhar as 7 autorizações com títulos, descrições e dados extras', async () => {
            const aluno = await Aluno.create({
                nome: 'Lucas Silva',
                escolaId: ESCOLA_A,
                turma: '4º Ano C',
                responsaveis: [
                    {
                        nome: 'Ana Silva',
                        parentesco: 'Mãe',
                        telefone: '11988887777',
                        email: 'ana@email.com',
                    },
                ],
                autorizacoesEscolares: {
                    tratamentoOdontologico: true,
                    conducaoEscolar: true,
                    motoristaNome: 'Seu João',
                    motoristaTelefone: '11977776666',
                    antitermico: true,
                    medicamentoNome: 'Dipirona',
                    medicamentoDose: '15 gotas',
                    atividadesExtraclasse: false,
                },
            });

            const { cookies } = await sessaoUsuario('secretaria', ESCOLA_A);
            const res = await request(app)
                .get(`/api/secretaria/autorizacoes/aluno/${aluno._id}`)
                .set('Cookie', cookies);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.aluno.nome).toBe('Lucas Silva');
            expect(res.body.responsavel.nome).toBe('Ana Silva');
            expect(res.body.autorizacoes).toHaveLength(7);

            // Verifica condução escolar com motorista
            const cond = res.body.autorizacoes.find((a) => a.tipo === 'conducaoEscolar');
            expect(cond.aceita).toBe(true);
            expect(cond.status).toBe('aceita');
            expect(cond.detalhes.motoristaNome).toBe('Seu João');
            expect(cond.detalhes.motoristaTelefone).toBe('11977776666');

            // Verifica antitérmico com remédio e dose
            const med = res.body.autorizacoes.find((a) => a.tipo === 'antitermico');
            expect(med.aceita).toBe(true);
            expect(med.detalhes.medicamentoNome).toBe('Dipirona');
            expect(med.detalhes.medicamentoDose).toBe('15 gotas');

            // Verifica atividades extraclasse recusadas
            const extra = res.body.autorizacoes.find((a) => a.tipo === 'atividadesExtraclasse');
            expect(extra.aceita).toBe(false);
            expect(extra.status).toBe('recusada');
        });
    });

    // ── 5. Sincronização via Responsável ────────────────────────────────────
    describe('Sincronização em tempo real via ResponsavelController', () => {
        it('deve sincronizar na coleção Autorizacao quando o responsável salva', async () => {
            const emailResp = 'pai_teste@exemplo.com';
            const aluno = await Aluno.create({
                nome: 'Mariana Santos',
                escolaId: ESCOLA_A,
                turma: '2º Ano A',
                responsavel: emailResp,
                responsaveis: [
                    {
                        nome: 'Marcos Santos',
                        email: emailResp,
                        parentesco: 'Pai',
                    },
                ],
            });

            const usuarioResp = await criarUsuario({
                email: emailResp,
                nome: 'Marcos Santos',
                perfil: 'responsavel',
                escolaId: ESCOLA_A,
            });

            const cookieResp = [`escola_jwt=${assinarTokenSessao(usuarioResp)}`];

            // Responsável atualiza suas autorizações
            const updatePayload = {
                autorizacoesEscolares: {
                    tratamentoOdontologico: true,
                    tratamentoMedicoEmergencial: true,
                    atividadesFisicas: false,
                    conducaoEscolar: true,
                    motoristaNome: 'Tio Beto',
                    motoristaTelefone: '11999990000',
                },
            };

            const resPut = await request(app)
                .put(`/api/responsavel/aluno/${aluno._id}/dados`)
                .set('Cookie', cookieResp)
                .send(updatePayload);

            expect(resPut.status).toBe(200);
            expect(resPut.body.success).toBe(true);

            // Confere se foram persistidos na coleção Autorizacao
            const authDocs = await Autorizacao.find({ alunoId: aluno._id }).lean();
            expect(authDocs.length).toBeGreaterThan(0);

            const authOdonto = authDocs.find((a) => a.tipoAutorizacao === 'tratamentoOdontologico');
            expect(authOdonto).toBeDefined();
            expect(authOdonto.aceita).toBe(true);
            expect(authOdonto.responsavelNome).toBe('Marcos Santos');

            const authFisica = authDocs.find((a) => a.tipoAutorizacao === 'atividadesFisicas');
            expect(authFisica).toBeDefined();
            expect(authFisica.aceita).toBe(false);

            const authCond = authDocs.find((a) => a.tipoAutorizacao === 'conducaoEscolar');
            expect(authCond.detalhes.motoristaNome).toBe('Tio Beto');

            // Agora a Secretaria consulta e deve ver os dados sincronizados
            const { cookies: cookiesSec } = await sessaoUsuario('secretaria', ESCOLA_A);
            const resSec = await request(app)
                .get(`/api/secretaria/autorizacoes/aluno/${aluno._id}`)
                .set('Cookie', cookiesSec);

            expect(resSec.status).toBe(200);
            expect(resSec.body.resumo.aceitas).toBe(3); // odonto, medico, conducao
            expect(resSec.body.resumo.naoAceitas).toBe(1); // fisica
        });
    });
});
