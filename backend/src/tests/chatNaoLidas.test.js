/**
 * chatNaoLidas.test.js — GET /api/chat-direto/nao-lidas (Issue #72).
 *
 * O endpoint alimenta o selo do menu, que aparece em toda página de todo
 * perfil. O que precisa ficar amarrado é a DIREÇÃO da contagem: são as
 * mensagens que chegaram para mim, não as que eu mandei. Errar o lado faz o
 * selo acender sozinho toda vez que a pessoa escreve algo — e ela nunca
 * consegue zerá-lo, porque não há nada para ler.
 *
 * Todos os nomes e e-mails aqui são inventados.
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
const Professor = require('../models/Professor');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

let escola;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

beforeEach(async () => {
    await limparBanco();
    escola = await Escola.create({
        nome: 'EE Nao Lidas',
        tipo: 'EMEF',
        bairro: 'Centro',
        codigoSecreto: 'NLID-72-A',
        ativo: true,
    });
    invalidarCacheEscolas();
});

async function professorLogado(email, salaPrincipal = '1A') {
    const user = await criarUsuario({
        email,
        perfil: 'professor',
        escolaId: String(escola._id),
    });
    await Professor.create({
        idUsuario: String(user._id),
        nome: user.nome,
        email,
        salaPrincipal,
        vinculos: [{ escolaId: String(escola._id), cargo: 'professor' }],
        ativo: true,
    });

    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email, senha: SENHA_TESTE });
    expect(login.status).toBe(200);
    return { agent, id: String(user._id) };
}

const enviar = (de, paraId, mensagem) =>
    de.agent.post('/api/chat-direto/enviar').send({ destinatarioId: paraId, mensagem });

async function total(sessao) {
    const res = await sessao.agent.get('/api/chat-direto/nao-lidas');
    expect(res.status).toBe(200);
    return res.body.data.total;
}

describe('conta o que chegou para mim', () => {
    it('começa em zero', async () => {
        const eu = await professorLogado('zero@escola.test');
        expect(await total(eu)).toBe(0);
    });

    it('soma cada mensagem recebida', async () => {
        const eu = await professorLogado('recebe@escola.test');
        const outro = await professorLogado('manda@escola.test');

        await enviar(outro, eu.id, 'primeira');
        await enviar(outro, eu.id, 'segunda');

        expect(await total(eu)).toBe(2);
    });

    it('NÃO conta o que eu enviei', async () => {
        // Errar o lado faria o selo acender sozinho toda vez que a pessoa
        // escrevesse — e ela nunca conseguiria zerá-lo.
        const eu = await professorLogado('remetente@escola.test');
        const outro = await professorLogado('destino@escola.test');

        await enviar(eu, outro.id, 'oi');

        expect(await total(eu)).toBe(0);
        expect(await total(outro)).toBe(1);
    });

    it('soma remetentes diferentes no mesmo número', async () => {
        const eu = await professorLogado('varios@escola.test');
        const a = await professorLogado('colega.a@escola.test');
        const b = await professorLogado('colega.b@escola.test');

        await enviar(a, eu.id, 'de a');
        await enviar(b, eu.id, 'de b');
        await enviar(b, eu.id, 'de b outra vez');

        expect(await total(eu)).toBe(3);
    });

    it('zera depois de a conversa ser marcada como lida', async () => {
        const eu = await professorLogado('leitor@escola.test');
        const outro = await professorLogado('escritor@escola.test');

        await enviar(outro, eu.id, 'leia isto');
        expect(await total(eu)).toBe(1);

        const marcar = await eu.agent.patch(`/api/chat-direto/lidas/${outro.id}`);
        expect(marcar.status).toBe(200);

        expect(await total(eu)).toBe(0);
    });
});

describe('isolamento entre contas', () => {
    it('cada pessoa vê só o próprio total', async () => {
        const a = await professorLogado('conta.a@escola.test');
        const b = await professorLogado('conta.b@escola.test');
        const c = await professorLogado('conta.c@escola.test');

        await enviar(c, a.id, 'para a');

        expect(await total(a)).toBe(1);
        expect(await total(b)).toBe(0);
    });
});

describe('autenticação', () => {
    it('exige sessão', async () => {
        const res = await request(app).get('/api/chat-direto/nao-lidas');
        expect(res.status).toBe(401);
    });
});
