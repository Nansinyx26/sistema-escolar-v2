/**
 * faltasFuncionarios.test.js
 * Planilha de Faltas FUNCIONÁRIOS: vigência (julho), escopo do professor
 * (só a própria planilha), poder da direção sobre o quadro, isolamento
 * multi-escola e a coluna CALENDÁRIO derivada do calendário escolar.
 */
const request = require('supertest');
const app = require('../app');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario, SENHA_TESTE } = require('./helpers');

const Escola = require('../models/Escola');
const Professor = require('../models/Professor');
const Diretor = require('../models/Diretor');
const CalendarioEscolar = require('../models/CalendarioEscolar');
const FaltaFuncionario = require('../models/FaltaFuncionario');

const ANO = 2026;
const MES_VIGENTE = 7;   // julho — início da planilha
const MES_ANTERIOR = 6;  // junho — ainda bloqueado

let escolaA, escolaB;

beforeAll(async () => { await conectarBanco(); });
afterAll(async () => { await desconectarBanco(); });

beforeEach(async () => {
    await limparBanco();
    escolaA = await Escola.create({
        nome: 'EMEF Planilha A', tipo: 'EMEF', bairro: 'Centro',
        codigoSecreto: 'PLAN-COD-A', ativo: true
    });
    escolaB = await Escola.create({
        nome: 'CIEP Planilha B', tipo: 'CIEP', bairro: 'Jardim',
        codigoSecreto: 'PLAN-COD-B', ativo: true
    });
});

// Diretor tem 2FA OBRIGATÓRIO (mustUse2FA no UserController): o login é em
// duas etapas e `twoFactorFixedCode` dá o código sem depender de e-mail.
const CODIGO_2FA = '424242';

async function logar(email, perfil, escola) {
    const usuario = await criarUsuario({
        email, perfil, escolaId: String(escola._id),
        // O campo guarda HASH scrypt (utils/codigosBackup); texto puro e recusado.
        twoFactorFixedCode: await require('../utils/codigosBackup').hashSegredo(CODIGO_2FA)
    });
    const vinculos = [{ escolaId: String(escola._id), cargo: perfil }];

    if (perfil === 'professor') {
        await Professor.create({
            idUsuario: String(usuario._id), nome: usuario.nome, email,
            salaPrincipal: '1A', vinculos, ativo: true
        });
    } else if (perfil === 'diretor') {
        await Diretor.create({
            idUsuario: String(usuario._id), nome: usuario.nome, email, vinculos, ativo: true
        });
    }

    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login')
        .send({ email, senha: SENHA_TESTE, escolaId: String(escola._id) });
    expect(login.status).toBe(200);

    if (login.body.requires2FA) {
        const verify = await agent.post('/api/auth/2fa/verify').send({ codigo: CODIGO_2FA });
        expect(verify.status).toBe(200);
    }

    return { agent, usuario };
}

const diaMarcado = (extra = {}) => ({
    dia: 10, abonadas: true, atestado: false, descontoHoras: 2,
    tre: false, injustificadas: false, observacoes: 'Consulta médica', ...extra
});

// ─────────────────────────────────────────────────────────
// Vigência
// ─────────────────────────────────────────────────────────
describe('Vigência da planilha (a partir de julho)', () => {
    it('abre julho normalmente', async () => {
        const { agent } = await logar('prof.vigencia@escola.test', 'professor', escolaA);
        const res = await agent.get(`/api/faltas-funcionarios/planilha?ano=${ANO}&mes=${MES_VIGENTE}`);
        expect(res.status).toBe(200);
        expect(res.body.data.rotulo).toBe('Julho/2026');
        expect(res.body.data.dias).toHaveLength(31);
    });

    it('recusa (400) um mês anterior ao início da vigência', async () => {
        const { agent } = await logar('prof.junho@escola.test', 'professor', escolaA);
        const res = await agent.get(`/api/faltas-funcionarios/planilha?ano=${ANO}&mes=${MES_ANTERIOR}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Julho/2026');
    });

    it('recusa a GRAVAÇÃO num mês anterior à vigência', async () => {
        const { agent } = await logar('prof.junho2@escola.test', 'professor', escolaA);
        const res = await agent.put('/api/faltas-funcionarios/planilha')
            .send({ ano: ANO, mes: MES_ANTERIOR, dias: [diaMarcado()] });
        expect(res.status).toBe(400);
        expect(await FaltaFuncionario.countDocuments()).toBe(0);
    });

    it('libera todos os meses dos anos seguintes', async () => {
        const { agent } = await logar('prof.2027@escola.test', 'professor', escolaA);
        const res = await agent.get('/api/faltas-funcionarios/planilha?ano=2027&mes=1');
        expect(res.status).toBe(200);
        expect(res.body.data.dias).toHaveLength(31);
    });
});

// ─────────────────────────────────────────────────────────
// Cabeçalho: escola e competência vêm do banco
// ─────────────────────────────────────────────────────────
describe('GET /api/faltas-funcionarios/contexto', () => {
    it('devolve o nome da escola da sessão e a vigência', async () => {
        const { agent, usuario } = await logar('prof.ctx@escola.test', 'professor', escolaA);
        const res = await agent.get('/api/faltas-funcionarios/contexto');

        expect(res.status).toBe(200);
        expect(res.body.data.escola.nome).toBe('EMEF Planilha A');
        expect(res.body.data.escola.id).toBe(String(escolaA._id));
        expect(res.body.data.usuario.id).toBe(String(usuario._id));
        expect(res.body.data.usuario.ehGestao).toBe(false);
        expect(res.body.data.vigencia).toEqual({ ano: 2026, mes: 7, rotulo: 'Julho/2026' });
        expect(res.body.data.meses).toHaveLength(12);
    });

    it('marca a direção como gestão', async () => {
        const { agent } = await logar('dir.ctx@escola.test', 'diretor', escolaA);
        const res = await agent.get('/api/faltas-funcionarios/contexto');
        expect(res.body.data.usuario.ehGestao).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────
// Escopo do professor
// ─────────────────────────────────────────────────────────
describe('Escopo do professor', () => {
    it('salva e relê a própria planilha', async () => {
        const { agent } = await logar('prof.salva@escola.test', 'professor', escolaA);

        const put = await agent.put('/api/faltas-funcionarios/planilha')
            .send({ ano: ANO, mes: MES_VIGENTE, dias: [diaMarcado(), diaMarcado({ dia: 15, abonadas: false, injustificadas: true, descontoHoras: 0, observacoes: '' })] });

        expect(put.status).toBe(200);
        expect(put.body.data.totais).toMatchObject({
            abonadas: 1, injustificadas: 1, descontoHoras: 2, diasComRegistro: 2
        });

        const get = await agent.get(`/api/faltas-funcionarios/planilha?ano=${ANO}&mes=${MES_VIGENTE}`);
        const dia10 = get.body.data.dias.find(d => d.dia === 10);
        expect(dia10.abonadas).toBe(true);
        expect(dia10.descontoHoras).toBe(2);
        expect(dia10.observacoes).toBe('Consulta médica');
        expect(get.body.data.podeEditar).toBe(true);
    });

    it('descarta dias sem nenhuma marcação (planilha esparsa)', async () => {
        const { agent } = await logar('prof.esparsa@escola.test', 'professor', escolaA);

        await agent.put('/api/faltas-funcionarios/planilha').send({
            ano: ANO, mes: MES_VIGENTE,
            dias: [
                diaMarcado(),
                { dia: 11, abonadas: false, atestado: false, descontoHoras: 0, tre: false, injustificadas: false, observacoes: '' }
            ]
        });

        const doc = await FaltaFuncionario.findOne({ ano: ANO, mes: MES_VIGENTE }).lean();
        expect(doc.dias).toHaveLength(1);
        expect(doc.dias[0].dia).toBe(10);
    });

    it('apaga o lançamento quando o dia é desmarcado', async () => {
        const { agent } = await logar('prof.apaga@escola.test', 'professor', escolaA);

        await agent.put('/api/faltas-funcionarios/planilha')
            .send({ ano: ANO, mes: MES_VIGENTE, dias: [diaMarcado()] });
        await agent.put('/api/faltas-funcionarios/planilha')
            .send({ ano: ANO, mes: MES_VIGENTE, dias: [] });

        const doc = await FaltaFuncionario.findOne({ ano: ANO, mes: MES_VIGENTE }).lean();
        expect(doc.dias).toHaveLength(0);
    });

    it('rejeita dia fora do mês e horas acima de 24', async () => {
        const { agent } = await logar('prof.limites@escola.test', 'professor', escolaA);

        await agent.put('/api/faltas-funcionarios/planilha').send({
            ano: ANO, mes: MES_VIGENTE,
            dias: [
                diaMarcado({ dia: 32 }),                       // julho tem 31
                diaMarcado({ dia: 5, descontoHoras: 99 })      // teto de 24h
            ]
        });

        const doc = await FaltaFuncionario.findOne({ ano: ANO, mes: MES_VIGENTE }).lean();
        expect(doc.dias).toHaveLength(1);
        expect(doc.dias[0].dia).toBe(5);
        expect(doc.dias[0].descontoHoras).toBe(24);
    });

    it('não abre a planilha de outro funcionário (403)', async () => {
        const outro = await logar('prof.alvo@escola.test', 'professor', escolaA);
        const { agent } = await logar('prof.curioso@escola.test', 'professor', escolaA);

        const res = await agent.get(
            `/api/faltas-funcionarios/planilha?ano=${ANO}&mes=${MES_VIGENTE}&funcionarioId=${outro.usuario._id}`
        );
        expect(res.status).toBe(403);
    });

    it('não grava na planilha de outro funcionário (403)', async () => {
        const outro = await logar('prof.alvo2@escola.test', 'professor', escolaA);
        const { agent } = await logar('prof.curioso2@escola.test', 'professor', escolaA);

        const res = await agent.put('/api/faltas-funcionarios/planilha').send({
            ano: ANO, mes: MES_VIGENTE, funcionarioId: String(outro.usuario._id), dias: [diaMarcado()]
        });
        expect(res.status).toBe(403);
        expect(await FaltaFuncionario.countDocuments()).toBe(0);
    });

    it('não lista o quadro de funcionários (403)', async () => {
        const { agent } = await logar('prof.lista@escola.test', 'professor', escolaA);
        const res = await agent.get('/api/faltas-funcionarios/funcionarios');
        expect(res.status).toBe(403);
    });
});

// ─────────────────────────────────────────────────────────
// Direção
// ─────────────────────────────────────────────────────────
describe('Direção', () => {
    it('lista os funcionários da própria escola e não os de outra', async () => {
        await logar('prof.a1@escola.test', 'professor', escolaA);
        await logar('prof.b1@escola.test', 'professor', escolaB);
        const { agent } = await logar('dir.lista@escola.test', 'diretor', escolaA);

        const res = await agent.get('/api/faltas-funcionarios/funcionarios');
        expect(res.status).toBe(200);

        const emails = res.body.data.map(f => f.email);
        expect(emails).toContain('prof.a1@escola.test');
        expect(emails).not.toContain('prof.b1@escola.test');
    });

    it('lança a planilha de um professor da escola', async () => {
        const prof = await logar('prof.gerido@escola.test', 'professor', escolaA);
        const { agent } = await logar('dir.lanca@escola.test', 'diretor', escolaA);

        const put = await agent.put('/api/faltas-funcionarios/planilha').send({
            ano: ANO, mes: MES_VIGENTE, funcionarioId: String(prof.usuario._id),
            dias: [diaMarcado({ atestado: true })]
        });
        expect(put.status).toBe(200);

        // O professor enxerga o que a direção lançou para ele
        const get = await prof.agent.get(`/api/faltas-funcionarios/planilha?ano=${ANO}&mes=${MES_VIGENTE}`);
        expect(get.body.data.dias.find(d => d.dia === 10).atestado).toBe(true);
        expect(get.body.data.atualizadoPorNome).toBeTruthy();
    });

    it('não alcança funcionário de outra escola (404)', async () => {
        const profB = await logar('prof.b2@escola.test', 'professor', escolaB);
        const { agent } = await logar('dir.isolado@escola.test', 'diretor', escolaA);

        const res = await agent.get(
            `/api/faltas-funcionarios/planilha?ano=${ANO}&mes=${MES_VIGENTE}&funcionarioId=${profB.usuario._id}`
        );
        expect(res.status).toBe(404);
    });

    it('consolida o mês por funcionário no resumo', async () => {
        const prof = await logar('prof.resumo@escola.test', 'professor', escolaA);
        await prof.agent.put('/api/faltas-funcionarios/planilha')
            .send({ ano: ANO, mes: MES_VIGENTE, dias: [diaMarcado(), diaMarcado({ dia: 12 })] });

        const { agent } = await logar('dir.resumo@escola.test', 'diretor', escolaA);
        const res = await agent.get(`/api/faltas-funcionarios/resumo?ano=${ANO}&mes=${MES_VIGENTE}`);

        expect(res.status).toBe(200);
        const linha = res.body.data.find(f => f.email === 'prof.resumo@escola.test');
        expect(linha.totais).toMatchObject({ abonadas: 2, descontoHoras: 4, diasComRegistro: 2 });
    });
});

// ─────────────────────────────────────────────────────────
// Isolamento multi-escola da própria planilha
// ─────────────────────────────────────────────────────────
describe('Isolamento por escola', () => {
    it('grava a planilha com o escolaId da sessão', async () => {
        const { agent, usuario } = await logar('prof.tenant@escola.test', 'professor', escolaA);
        await agent.put('/api/faltas-funcionarios/planilha')
            .send({ ano: ANO, mes: MES_VIGENTE, dias: [diaMarcado()] });

        const doc = await FaltaFuncionario.findOne({ funcionarioId: String(usuario._id) }).lean();
        expect(doc.escolaId).toBe(String(escolaA._id));
    });

    it('não devolve lançamento gravado sob outra escola', async () => {
        const { agent, usuario } = await logar('prof.tenant2@escola.test', 'professor', escolaA);

        // Mesmo funcionário, planilha gravada no tenant da escola B
        await FaltaFuncionario.create({
            escolaId: String(escolaB._id), funcionarioId: String(usuario._id),
            funcionarioNome: usuario.nome, cargo: 'professor',
            ano: ANO, mes: MES_VIGENTE, dias: [diaMarcado()]
        });

        const res = await agent.get(`/api/faltas-funcionarios/planilha?ano=${ANO}&mes=${MES_VIGENTE}`);
        expect(res.status).toBe(200);
        expect(res.body.data.totais.diasComRegistro).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────
// Coluna CALENDÁRIO
// ─────────────────────────────────────────────────────────
describe('Coluna CALENDÁRIO', () => {
    it('marca fim de semana e dia letivo sem nenhum evento cadastrado', async () => {
        const { agent } = await logar('prof.cal@escola.test', 'professor', escolaA);
        const res = await agent.get(`/api/faltas-funcionarios/planilha?ano=${ANO}&mes=${MES_VIGENTE}`);

        // 4/jul/2026 é sábado; 6/jul/2026 é segunda
        const sabado = res.body.data.dias.find(d => d.dia === 4);
        const segunda = res.body.data.dias.find(d => d.dia === 6);

        expect(sabado.calendario.tipo).toBe('fim_de_semana');
        expect(sabado.calendario.letivo).toBe(false);
        expect(segunda.calendario.tipo).toBe('aula');
        expect(segunda.calendario.letivo).toBe(true);
    });

    it('reflete feriado cadastrado no calendário da escola', async () => {
        const { agent, usuario } = await logar('prof.cal2@escola.test', 'professor', escolaA);

        await CalendarioEscolar.create({
            titulo: 'Feriado Municipal', tipo: 'feriado', anoLetivo: ANO,
            escolaId: String(escolaA._id),
            dataInicio: new Date(ANO, MES_VIGENTE - 1, 9),
            dataFim: new Date(ANO, MES_VIGENTE - 1, 9),
            criadoPor: String(usuario._id), ativo: true
        });

        const res = await agent.get(`/api/faltas-funcionarios/planilha?ano=${ANO}&mes=${MES_VIGENTE}`);
        const dia9 = res.body.data.dias.find(d => d.dia === 9);

        expect(dia9.calendario.tipo).toBe('feriado');
        expect(dia9.calendario.rotulo).toBe('Feriado Municipal');
        expect(dia9.calendario.letivo).toBe(false);
    });

    it('ignora feriado cadastrado por OUTRA escola', async () => {
        const { agent, usuario } = await logar('prof.cal3@escola.test', 'professor', escolaA);

        await CalendarioEscolar.create({
            titulo: 'Aniversário da Escola B', tipo: 'feriado', anoLetivo: ANO,
            escolaId: String(escolaB._id),
            dataInicio: new Date(ANO, MES_VIGENTE - 1, 9),
            dataFim: new Date(ANO, MES_VIGENTE - 1, 9),
            criadoPor: String(usuario._id), ativo: true
        });

        const res = await agent.get(`/api/faltas-funcionarios/planilha?ano=${ANO}&mes=${MES_VIGENTE}`);
        expect(res.body.data.dias.find(d => d.dia === 9).calendario.tipo).toBe('aula');
    });
});
