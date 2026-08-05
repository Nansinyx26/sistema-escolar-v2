/**
 * escopoComentariosSeguranca.test.js
 *
 * Regressão das falhas de severidade média da auditoria:
 *
 *   #5 Comentários: qualquer autenticado lia/escrevia na thread de qualquer
 *      comunicado ou notificação informando só o id — sem checar escola nem
 *      destinatários.
 *   #6 Código secreto: qualquer diretor lia e rotacionava o código GLOBAL
 *      (CONFIG_GERAL), que autoriza cadastro de diretor/secretaria — afetando
 *      a rede inteira, não só a escola dele.
 */
const request = require('supertest');
const app = require('../app');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario, SENHA_TESTE } = require('./helpers');

const Escola = require('../models/Escola');
const Professor = require('../models/Professor');
const Diretor = require('../models/Diretor');
const Comunicado = require('../models/Comunicado');
const Comentario = require('../models/Comentario');
const SecurityConfig = require('../models/SecurityConfig');

let escolaA, escolaB;

beforeAll(async () => { await conectarBanco(); });
afterAll(async () => { await desconectarBanco(); });

beforeEach(async () => {
    await limparBanco();
    escolaA = await Escola.create({ nome: 'CIEP A', tipo: 'CIEP', codigoSecreto: 'COD-A-1', ativo: true });
    escolaB = await Escola.create({ nome: 'EMEF B', tipo: 'EMEF', codigoSecreto: 'COD-B-2', ativo: true });
});

// e-mails sempre minúsculos: o login normaliza com toLowerCase(), o cadastro não.
async function agentProfessor(email, escola) {
    const user = await criarUsuario({ email, perfil: 'professor', escolaId: String(escola._id) });
    await Professor.create({
        idUsuario: String(user._id), nome: user.nome, email, salaPrincipal: '1A',
        vinculos: [{ escolaId: String(escola._id), cargo: 'professor' }], ativo: true
    });
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login')
        .send({ email, senha: SENHA_TESTE, escolaId: String(escola._id) });
    expect(login.status).toBe(200);
    return { agent, user };
}

async function agentResponsavel(email, escola) {
    const user = await criarUsuario({ email, perfil: 'responsavel', escolaId: String(escola._id) });
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email, senha: SENHA_TESTE });
    expect(login.status).toBe(200);
    return { agent, user };
}

async function agentDiretor(email, escola) {
    const CODIGO_FIXO = '424242';
    const user = await criarUsuario({
        email, perfil: 'diretor', escolaId: String(escola._id), twoFactorFixedCode: CODIGO_FIXO
    });
    await Diretor.create({
        idUsuario: String(user._id), nome: user.nome, email,
        vinculos: [{ escolaId: String(escola._id), cargo: 'diretor' }], ativo: true
    });
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login')
        .send({ email, senha: SENHA_TESTE, escolaId: String(escola._id) });
    expect(login.status).toBe(200);
    const verify = await agent.post('/api/auth/2fa/verify').send({ codigo: CODIGO_FIXO });
    expect(verify.status).toBe(200);
    return { agent, user };
}

function criarComunicado(escola, destinatarios) {
    return Comunicado.create({
        escolaId: String(escola._id),
        titulo: 'Comunicado interno',
        conteudo: 'CONTEUDO-SIGILOSO',
        destinatarios,
        ativo: true
    });
}

// ─────────────────────────────────────────────────────────
// #5 — Escopo dos comentários
// ─────────────────────────────────────────────────────────
describe('GET /api/comentarios/comunicado/:id — escopo da thread', () => {
    it('NÃO devolve comentários de comunicado de OUTRA escola', async () => {
        const comunicadoB = await criarComunicado(escolaB, ['todos']);
        await Comentario.create({
            comunicadoId: comunicadoB._id, usuarioId: (await criarUsuario({}))._id,
            usuarioNome: 'Alguém', texto: 'COMENTARIO-DA-ESCOLA-B', ativo: true
        });

        const { agent } = await agentProfessor('espiao@escola.test', escolaA);
        const res = await agent.get(`/api/comentarios/comunicado/${comunicadoB._id}`);

        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body)).not.toContain('COMENTARIO-DA-ESCOLA-B');
    });

    it('NÃO devolve comentários de comunicado a que o perfil não é destinatário', async () => {
        // Comunicado só para professores; quem consulta é responsável.
        const comunicado = await criarComunicado(escolaA, ['professores']);
        await Comentario.create({
            comunicadoId: comunicado._id, usuarioId: (await criarUsuario({}))._id,
            usuarioNome: 'Prof', texto: 'CONVERSA-INTERNA-DOCENTE', ativo: true
        });

        const { agent } = await agentResponsavel('curioso@escola.test', escolaA);
        const res = await agent.get(`/api/comentarios/comunicado/${comunicado._id}`);

        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).not.toContain('CONVERSA-INTERNA-DOCENTE');
    });

    it('DEVOLVE os comentários para quem é destinatário (recurso segue funcionando)', async () => {
        const comunicado = await criarComunicado(escolaA, ['todos']);
        await Comentario.create({
            comunicadoId: comunicado._id, usuarioId: (await criarUsuario({}))._id,
            usuarioNome: 'Prof', texto: 'comentario-visivel', ativo: true
        });

        const { agent } = await agentProfessor('legitimo@escola.test', escolaA);
        const res = await agent.get(`/api/comentarios/comunicado/${comunicado._id}`);

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].texto).toBe('comentario-visivel');
    });
});

describe('POST /api/comentarios — só comenta quem enxerga a mensagem', () => {
    it('NÃO deixa comentar em comunicado de outra escola', async () => {
        const comunicadoB = await criarComunicado(escolaB, ['todos']);
        const { agent } = await agentProfessor('intruso@escola.test', escolaA);

        const res = await agent.post('/api/comentarios')
            .send({ comunicadoId: String(comunicadoB._id), texto: 'invadindo' });

        expect(res.status).toBe(404);
        expect(await Comentario.countDocuments({ comunicadoId: comunicadoB._id })).toBe(0);
    });

    it('NÃO deixa comentar em comunicado a que não é destinatário', async () => {
        const comunicado = await criarComunicado(escolaA, ['professores']);
        const { agent } = await agentResponsavel('naodestinatario@escola.test', escolaA);

        const res = await agent.post('/api/comentarios')
            .send({ comunicadoId: String(comunicado._id), texto: 'me intrometendo' });

        expect(res.status).toBe(403);
        expect(await Comentario.countDocuments({ comunicadoId: comunicado._id })).toBe(0);
    });

    it('PERMITE comentar quando é destinatário', async () => {
        const comunicado = await criarComunicado(escolaA, ['todos']);
        const { agent } = await agentProfessor('participante@escola.test', escolaA);

        const res = await agent.post('/api/comentarios')
            .send({ comunicadoId: String(comunicado._id), texto: 'comentario legitimo' });

        expect(res.status).toBe(201);
        expect(await Comentario.countDocuments({ comunicadoId: comunicado._id })).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────
// #6 — Escopo do código secreto de cadastro
// ─────────────────────────────────────────────────────────
describe('/api/security — código de cadastro é da escola, não da rede', () => {
    it('GET /status devolve o código da PRÓPRIA escola, não o global', async () => {
        await SecurityConfig.create({
            codigoSecretoEscola: 'CODIGO-GLOBAL-SECRETO',
            dataUltimaRotacao: new Date(),
            rotacaoAutomatica: false
        });

        const { agent } = await agentDiretor('diretora@escola.test', escolaA);
        const res = await agent.get('/api/security/status');

        expect(res.status).toBe(200);
        expect(res.body.data.codigo).toBe('COD-A-1');       // código da escola A
        expect(res.body.data.codigo).not.toBe('CODIGO-GLOBAL-SECRETO');
        expect(res.body.data.escopo).toBe('escola');
    });

    it('POST /rotate NÃO altera o código global nem o de outra escola', async () => {
        await SecurityConfig.create({
            codigoSecretoEscola: 'CODIGO-GLOBAL-SECRETO',
            dataUltimaRotacao: new Date(),
            rotacaoAutomatica: false
        });

        const { agent } = await agentDiretor('rotaciona@escola.test', escolaA);
        const res = await agent.post('/api/security/rotate');

        expect(res.status).toBe(200);
        expect(res.body.data.escopo).toBe('escola');

        // Global intacto
        const config = await SecurityConfig.findOne({ chave: 'CONFIG_GERAL' });
        expect(config.codigoSecretoEscola).toBe('CODIGO-GLOBAL-SECRETO');

        // Escola B intacta
        const b = await Escola.findById(escolaB._id).select('+codigoSecreto').lean();
        expect(b.codigoSecreto).toBe('COD-B-2');

        // Escola A rotacionada
        const a = await Escola.findById(escolaA._id).select('+codigoSecreto').lean();
        expect(a.codigoSecreto).not.toBe('COD-A-1');
        expect(a.codigoSecreto).toBe(res.body.data.codigo);
    });

    // Este caso é DETERMINÍSTICO de propósito. O teste de round-trip abaixo
    // depende de o código sorteado conter um caractere problemático, o que
    // acontecia em ~13% das execuções — um teste que falha 1 vez em 8 seria
    // descartado como flake. Aqui a propriedade é verificada direto na fonte.
    it('generateCode nunca produz código que a sanitização do body altera', () => {
        const SecurityController = require('../controllers/SecurityController');
        const { sanitizeInput } = require('../utils/sanitize');

        for (let i = 0; i < 300; i++) {
            const codigo = SecurityController.generateCode();
            expect(codigo).toHaveLength(10);
            // O código viaja no corpo da requisição e passa pelo sanitizador
            // global antes de chegar ao validateCode. Se ele for reescrito
            // (`&` → `&amp;`) ou truncado (`<` corta o resto), o cadastro
            // rejeita um código correto.
            expect(sanitizeInput(codigo)).toBe(codigo);
        }
    });

    it('o código rotacionado continua válido para cadastro NAQUELA escola', async () => {
        const { agent } = await agentDiretor('valida@escola.test', escolaA);
        const rotate = await agent.post('/api/security/rotate');
        const novoCodigo = rotate.body.data.codigo;

        // validate-code é público — confirma que o novo código resolve a escola A
        const res = await request(app).post('/api/auth/validate-code')
            .send({ codigo: novoCodigo, escolaId: String(escolaA._id) });

        expect(res.status).toBe(200);
        expect(res.body.valid).toBe(true);
        expect(res.body.escolaNome).toBe('CIEP A');
    });

    it('o alias legado /director-code tem o mesmo escopo de escola', async () => {
        await SecurityConfig.create({
            codigoSecretoEscola: 'CODIGO-GLOBAL-SECRETO',
            dataUltimaRotacao: new Date(),
            rotacaoAutomatica: false
        });

        const { agent } = await agentDiretor('alias@escola.test', escolaA);
        const res = await agent.post('/api/security/director-code');

        expect(res.status).toBe(200);
        expect(res.body.data.escopo).toBe('escola');

        const config = await SecurityConfig.findOne({ chave: 'CONFIG_GERAL' });
        expect(config.codigoSecretoEscola).toBe('CODIGO-GLOBAL-SECRETO');
    });
});
