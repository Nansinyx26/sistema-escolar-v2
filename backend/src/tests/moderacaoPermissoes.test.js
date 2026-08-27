/**
 * moderacaoPermissoes.test.js — §7 da ESPEC-MODERACAO-CHAT.md.
 *
 * Este é o arquivo que guarda as três coisas que, se quebrarem, transformam a
 * moderação em vazamento de dado de menor:
 *
 *   1. **Isolamento por escola (P4)** — coordenação da escola A não alcança
 *      ocorrência da escola B, nem pela lista, nem pelo id direto.
 *   2. **R4, tratado como bloqueante da Fase 0** — o `admin` de plataforma não
 *      entra sem dizer de qual escola está falando, e o acesso vira registro.
 *   3. **Revisor ≠ decisor (cláusula 9.3 do Termo)** — quem aplicou a medida não
 *      pode ser quem julga a contestação dela.
 */

const request = require('supertest');
const app = require('../app');
const {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    criarUsuario,
    SENHA_TESTE,
} = require('./helpers');

const Escola = require('../models/Escola');
const Diretor = require('../models/Diretor');
const AuditLog = require('../models/AuditLog');
const ModeracaoOcorrencia = require('../models/ModeracaoOcorrencia');

const CODIGO_FIXO = '424242';

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
    escolaA = await Escola.create({
        nome: 'Escola A',
        tipo: 'EMEF',
        codigoSecreto: 'cod-a',
        ativo: true,
    });
    escolaB = await Escola.create({
        nome: 'Escola B',
        tipo: 'CIEP',
        codigoSecreto: 'cod-b',
        ativo: true,
    });
});

/** Diretor tem 2FA obrigatório — login em duas etapas, com código fixo. */
async function agentDiretor(email, escola) {
    const user = await criarUsuario({
        email,
        perfil: 'diretor',
        escolaId: String(escola._id),
        twoFactorFixedCode: await require('../utils/codigosBackup').hashSegredo(CODIGO_FIXO),
    });
    await Diretor.create({
        idUsuario: String(user._id),
        nome: user.nome,
        email,
        telefone: '(19) 90000-0000',
        vinculos: [{ escolaId: String(escola._id), cargo: 'diretor' }],
        ativo: true,
    });

    const agent = request.agent(app);
    const login = await agent
        .post('/api/auth/login')
        .send({ email, senha: SENHA_TESTE, escolaId: String(escola._id) });
    expect(login.status).toBe(200);
    const verify = await agent.post('/api/auth/2fa/verify').send({ codigo: CODIGO_FIXO });
    expect(verify.status).toBe(200);

    return { agent, user };
}

async function agentSimples(perfil, email) {
    await criarUsuario({ email, perfil });
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email, senha: SENHA_TESTE });
    expect(login.status).toBe(200);
    return agent;
}

async function criarOcorrencia(escola, overrides = {}) {
    return ModeracaoOcorrencia.create({
        escolaId: String(escola._id),
        tipoConteudo: 'texto',
        camada: 'lexico',
        severidade: 'moderada',
        remetenteId: 'remetente-1',
        remetentePerfil: 'responsavel',
        decisaoAutomatica: 'em_revisao',
        statusAtual: 'pendente',
        ...overrides,
    });
}

describe('GET /api/moderacao/fila — quem entra', () => {
    it('professor não vê a fila', async () => {
        const agent = await agentSimples('professor', 'prof_mod@escola.test');
        const res = await agent.get('/api/moderacao/fila');
        expect(res.status).toBe(403);
    });

    it('responsável não vê a fila', async () => {
        const agent = await agentSimples('responsavel', 'resp_mod@escola.test');
        const res = await agent.get('/api/moderacao/fila');
        expect(res.status).toBe(403);
    });

    it('diretor vê a fila da PRÓPRIA escola', async () => {
        await criarOcorrencia(escolaA);
        await criarOcorrencia(escolaB);

        const { agent } = await agentDiretor('dir_a@escola.test', escolaA);
        const res = await agent.get('/api/moderacao/fila');

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].escolaId).toBe(String(escolaA._id));
    });

    it('anônimo não chega na fila', async () => {
        const res = await request(app).get('/api/moderacao/fila');
        expect(res.status).toBe(401);
    });
});

describe('Isolamento entre escolas (P4)', () => {
    it('diretor da escola A não abre ocorrência da escola B nem pelo id', async () => {
        const daB = await criarOcorrencia(escolaB);

        const { agent } = await agentDiretor('dir_iso@escola.test', escolaA);
        const res = await agent.get(`/api/moderacao/ocorrencia/${daB._id}`);

        // 404 e não 403: um 403 confirmaria que aquele id existe em outra escola.
        expect(res.status).toBe(404);
    });

    it('diretor da escola A não decide ocorrência da escola B', async () => {
        const daB = await criarOcorrencia(escolaB);

        const { agent } = await agentDiretor('dir_iso2@escola.test', escolaA);
        const res = await agent
            .post(`/api/moderacao/ocorrencia/${daB._id}/decidir`)
            .send({ decisao: 'aprovar', justificativa: 'nada demais' });

        expect(res.status).toBe(404);
        // E a ocorrência da outra escola continua intocada.
        expect((await ModeracaoOcorrencia.findById(daB._id).lean()).statusAtual).toBe('pendente');
    });
});

/**
 * R4 — o risco que a spec marca como BLOQUEANTE da Fase 0.
 *
 * O `authorize` comum libera admin antes de qualquer checagem. Numa fila de
 * conteúdo sinalizado de menores, isso significa acesso cross-tenant como
 * efeito colateral do perfil — ninguém escolheu a escola, ninguém registrou.
 */
describe('R4 — admin precisa dizer de qual escola está falando', () => {
    it('admin sem escolaId toma 400 com código explícito', async () => {
        await criarOcorrencia(escolaA);

        const agent = await agentSimples('admin', 'admin_mod@escola.test');
        const res = await agent.get('/api/moderacao/fila');

        expect(res.status).toBe(400);
        expect(res.body.codigo).toBe('ESCOLA_NAO_INFORMADA');
    });

    it('admin com escolaId entra e vê apenas aquela escola', async () => {
        await criarOcorrencia(escolaA);
        await criarOcorrencia(escolaB);

        const agent = await agentSimples('admin', 'admin_mod2@escola.test');
        const res = await agent.get(`/api/moderacao/fila?escolaId=${escolaB._id}`);

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].escolaId).toBe(String(escolaB._id));
    });
});

describe('Abrir ocorrência deixa rastro (§6.3)', () => {
    it('grava MODERACAO_VISUALIZAR no AuditLog', async () => {
        const ocorrencia = await criarOcorrencia(escolaA);

        const { agent } = await agentDiretor('dir_audit@escola.test', escolaA);
        const res = await agent.get(`/api/moderacao/ocorrencia/${ocorrencia._id}`);

        expect(res.status).toBe(200);

        const log = await AuditLog.findOne({ acao: 'MODERACAO_VISUALIZAR' }).lean();
        expect(log).toBeTruthy();
        expect(String(log.recursoId)).toBe(String(ocorrencia._id));
    });

    it('a resposta do painel não carrega conteúdo da conversa', async () => {
        const ocorrencia = await criarOcorrencia(escolaA, { conteudoHash: 'a'.repeat(64) });

        const { agent } = await agentDiretor('dir_sem_texto@escola.test', escolaA);
        const res = await agent.get(`/api/moderacao/ocorrencia/${ocorrencia._id}`);

        expect(res.status).toBe(200);
        // O hash não serve a quem revisa e só dá superfície para correlação.
        expect(res.body.data.conteudoHash).toBeUndefined();
        expect(res.body.data).toHaveProperty('severidade');
    });
});

describe('Casos CRÍTICOS vão para a direção (§7.3)', () => {
    it('não aparecem na fila de quem não é direção', async () => {
        // Sem perfil `coordenacao` no enum de Usuario ainda, o teste exercita a
        // regra pelo lado do controller: quem não está em PERFIS_CASOS_CRITICOS
        // não recebe crítica na fila. Ver nota em routes/moderacao.js.
        const { PERFIS_CASOS_CRITICOS } = require('../controllers/ModeracaoController');
        expect(PERFIS_CASOS_CRITICOS.has('diretor')).toBe(true);
        expect(PERFIS_CASOS_CRITICOS.has('admin')).toBe(true);
        expect(PERFIS_CASOS_CRITICOS.has('coordenacao')).toBe(false);
    });

    it('a direção vê o caso crítico', async () => {
        await criarOcorrencia(escolaA, { severidade: 'critica' });

        const { agent } = await agentDiretor('dir_critico@escola.test', escolaA);
        const res = await agent.get('/api/moderacao/fila');

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].severidade).toBe('critica');
    });
});

describe('POST /ocorrencia/:id/decidir', () => {
    it('exige justificativa', async () => {
        const ocorrencia = await criarOcorrencia(escolaA);
        const { agent } = await agentDiretor('dir_just@escola.test', escolaA);

        const res = await agent
            .post(`/api/moderacao/ocorrencia/${ocorrencia._id}/decidir`)
            .send({ decisao: 'aprovar' });

        expect(res.status).toBe(400);
    });

    it('registra a decisão, o autor e o AuditLog', async () => {
        const ocorrencia = await criarOcorrencia(escolaA);
        const { agent, user } = await agentDiretor('dir_dec@escola.test', escolaA);

        const res = await agent
            .post(`/api/moderacao/ocorrencia/${ocorrencia._id}/decidir`)
            .send({ decisao: 'aprovar', justificativa: 'Falso positivo do léxico.' });

        expect(res.status).toBe(200);

        const depois = await ModeracaoOcorrencia.findById(ocorrencia._id).lean();
        expect(depois.statusAtual).toBe('revertida');
        expect(String(depois.revisao.moderadorId)).toBe(String(user._id));
        expect(depois.revisao.justificativa).toBe('Falso positivo do léxico.');

        expect(await AuditLog.countDocuments({ acao: 'MODERACAO_DECIDIR' })).toBe(1);
    });

    it('não deixa decidir duas vezes', async () => {
        const ocorrencia = await criarOcorrencia(escolaA);
        const { agent } = await agentDiretor('dir_dupla@escola.test', escolaA);

        const primeira = await agent
            .post(`/api/moderacao/ocorrencia/${ocorrencia._id}/decidir`)
            .send({ decisao: 'manter_bloqueio', justificativa: 'Conteúdo impróprio.' });
        expect(primeira.status).toBe(200);

        const segunda = await agent
            .post(`/api/moderacao/ocorrencia/${ocorrencia._id}/decidir`)
            .send({ decisao: 'aprovar', justificativa: 'Mudei de ideia.' });
        expect(segunda.status).toBe(409);
        expect(segunda.body.codigo).toBe('JA_DECIDIDA');
    });
});

describe('Contestação — cláusula 9 do Termo', () => {
    it('só o autor do conteúdo contesta', async () => {
        const ocorrencia = await criarOcorrencia(escolaA, { remetenteId: 'outra-pessoa' });

        const agent = await agentSimples('responsavel', 'resp_cont@escola.test');
        const res = await agent
            .post('/api/moderacao/contestar')
            .send({ ocorrenciaId: String(ocorrencia._id), motivo: 'não fui eu' });

        expect(res.status).toBe(404);
    });

    it('contestar trava a exclusão automática (cláusula 8.6)', async () => {
        await criarUsuario({ email: 'autor@escola.test', perfil: 'responsavel' });
        const usuario = await require('../models/Usuario').findOne({ email: 'autor@escola.test' });

        const ocorrencia = await criarOcorrencia(escolaA, {
            remetenteId: String(usuario._id),
            expiraEm: new Date(Date.now() + 1000),
        });

        const agent = request.agent(app);
        const login = await agent
            .post('/api/auth/login')
            .send({ email: 'autor@escola.test', senha: SENHA_TESTE });
        expect(login.status).toBe(200);

        const res = await agent
            .post('/api/moderacao/contestar')
            .send({ ocorrenciaId: String(ocorrencia._id), motivo: 'foi tirado de contexto' });

        expect(res.status).toBe(201);

        const depois = await ModeracaoOcorrencia.findById(ocorrencia._id).lean();
        expect(depois.contestacao.solicitadoEm).toBeTruthy();
        // Sem isto, uma contestação feita perto do fim do prazo perderia a
        // própria prova para o TTL do Mongo.
        expect(depois.expiraEm).toBeNull();
    });

    /**
     * Cláusula 9.3, a regra que impede a revisão de ser autoconfirmação: quem
     * aplicou a medida não julga a contestação dela.
     */
    it('quem decidiu não responde a própria contestação', async () => {
        const { agent, user } = await agentDiretor('dir_9_3@escola.test', escolaA);

        const ocorrencia = await criarOcorrencia(escolaA, {
            statusAtual: 'mantida',
            revisao: {
                moderadorId: String(user._id),
                moderadorPerfil: 'diretor',
                decididoEm: new Date(),
                decisao: 'manter_bloqueio',
                justificativa: 'Conteúdo impróprio.',
            },
            contestacao: { solicitadoEm: new Date(), motivoUsuario: 'discordo' },
        });

        const res = await agent
            .post(`/api/moderacao/contestacao/${ocorrencia._id}/responder`)
            .send({ resultado: 'improcedente' });

        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('REVISOR_IGUAL_DECISOR');
    });

    it('outro moderador responde normalmente', async () => {
        const primeiro = await agentDiretor('dir_um@escola.test', escolaA);

        const ocorrencia = await criarOcorrencia(escolaA, {
            statusAtual: 'mantida',
            revisao: {
                moderadorId: String(primeiro.user._id),
                moderadorPerfil: 'diretor',
                decididoEm: new Date(),
                decisao: 'manter_bloqueio',
                justificativa: 'Conteúdo impróprio.',
            },
            contestacao: { solicitadoEm: new Date(), motivoUsuario: 'discordo' },
        });

        const segundo = await agentDiretor('dir_dois@escola.test', escolaA);
        const res = await segundo.agent
            .post(`/api/moderacao/contestacao/${ocorrencia._id}/responder`)
            .send({ resultado: 'procedente' });

        expect(res.status).toBe(200);

        const depois = await ModeracaoOcorrencia.findById(ocorrencia._id).lean();
        expect(depois.contestacao.resultado).toBe('procedente');
        expect(depois.statusAtual).toBe('revertida');
        // Contestação encerrada ⇒ o prazo de retenção volta a correr.
        expect(depois.expiraEm).toBeTruthy();

        expect(await AuditLog.countDocuments({ acao: 'MODERACAO_CONTESTACAO_RESPONDER' })).toBe(1);
    });
});

describe('Aceite do Termo — cláusula 2', () => {
    it('começa como não aceito e passa a aceito depois do POST', async () => {
        const agent = await agentSimples('responsavel', 'resp_termo@escola.test');

        const antes = await agent.get('/api/moderacao/aceite-termo');
        expect(antes.status).toBe(200);
        expect(antes.body.data.aceito).toBe(false);

        const aceite = await agent.post('/api/moderacao/aceite-termo').send({});
        expect(aceite.status).toBe(201);

        const depois = await agent.get('/api/moderacao/aceite-termo');
        expect(depois.body.data.aceito).toBe(true);
        expect(depois.body.data.versao).toBe('1.0');
    });

    it('o aceite fica no lgpdHistory, junto dos demais termos', async () => {
        const agent = await agentSimples('professor', 'prof_termo@escola.test');
        await agent.post('/api/moderacao/aceite-termo').send({});

        const usuario = await require('../models/Usuario')
            .findOne({ email: 'prof_termo@escola.test' })
            .lean();

        const registro = usuario.lgpdHistory.find((r) => r.termoId === 'termo_audio_imagem');
        expect(registro).toBeTruthy();
        expect(registro.versao).toBe('1.0');
        expect(registro.aceitoEm).toBeTruthy();
    });
});
