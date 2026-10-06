/**
 * socketCaiNaRevogacao.test.js — Issue #667
 *
 * O handshake do Socket.IO confere a sessão só na conexão. Redefinir a senha,
 * desativar ou excluir a conta e sair não derrubavam o socket já aberto: ele
 * seguia nas salas e recebendo mensagens. Os testes usam a autenticação real do
 * handshake e um cliente WebSocket mínimo; o handler de conexão repete as salas
 * de index.js que importam aqui.
 */
const http = require('node:http');
const WebSocket = require('ws');
const { Server } = require('socket.io');
const request = require('supertest');
const app = require('../app');
const RecuperacaoSenha = require('../models/RecuperacaoSenha');
const JWT_SECRET = require('../utils/jwtConfig');
const { criarAutenticacaoSocket } = require('../realtime/autenticarSocket');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { hashSegredo } = require('../utils/codigosBackup');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

let server;
let io;
let porta;
const clientes = [];

beforeAll(async () => {
    await conectarBanco();
    server = http.createServer(app);
    io = new Server(server);
    io.use(criarAutenticacaoSocket(JWT_SECRET));
    io.on('connection', (socket) => {
        socket.join(`user:${socket.user.id || socket.user._id}`);
        socket.join(`role:${socket.user.perfil}`);
    });
    global.io = io;
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    porta = server.address().port;
});
afterEach(async () => {
    for (const c of clientes.splice(0)) c.close();
    await limparBanco();
});
afterAll(async () => {
    global.io = undefined;
    io.close();
    await new Promise((r) => server.close(r));
    await desconectarBanco();
});

/** Cliente Socket.IO mínimo (protocolo EIO=4) sobre `ws`; marca quando cai. */
function conectarSocket(token) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${porta}/socket.io/?EIO=4&transport=websocket`);
        clientes.push(ws);
        ws.caiu = false;
        ws.on('message', (bruto) => {
            const msg = bruto.toString();
            if (msg.startsWith('0')) ws.send(`40${JSON.stringify({ token })}`);
            else if (msg === '2') ws.send('3');
            else if (msg.startsWith('40')) resolve(ws);
            else if (msg.startsWith('44')) reject(new Error(msg));
            else if (msg.startsWith('41')) ws.caiu = true; // desconectado pelo servidor
        });
        ws.on('close', () => {
            ws.caiu = true;
        });
        ws.on('error', reject);
    });
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const socketsDa = async (usuario) => (await io.in(`user:${usuario._id}`).fetchSockets()).length;
const cookieDe = (usuario) => [`escola_jwt=${assinarTokenSessao(usuario)}`];

it('a redefinição de senha derruba o socket aberto com o token antigo', async () => {
    const vitima = await criarUsuario({ email: 'vitima.667@escola.test', perfil: 'diretor' });
    const ws = await conectarSocket(assinarTokenSessao(vitima));
    expect(await socketsDa(vitima)).toBe(1);

    await RecuperacaoSenha.create({
        usuarioId: vitima._id,
        codigo: await hashSegredo('135790'),
        criadoEm: new Date(),
        expiraEm: new Date(Date.now() + 15 * 60 * 1000),
        status: 'ativo',
        tentativas: 0,
    });
    const reset = await request(app).post('/api/auth/reset-password').send({
        email: 'vitima.667@escola.test',
        codigo: '135790',
        password: 'NovaSenha#2026',
    });
    expect(reset.status).toBe(200);

    await esperar(150);
    expect(ws.caiu).toBe(true);
    expect(await socketsDa(vitima)).toBe(0);
});

it('a desativação pela gestão derruba o socket da conta', async () => {
    const admin = await criarUsuario({ email: 'adm.667@escola.test', perfil: 'admin' });
    const prof = await criarUsuario({ email: 'prof.667@escola.test', perfil: 'professor' });
    const ws = await conectarSocket(assinarTokenSessao(prof));

    const res = await request(app)
        .put(`/api/usuarios/${prof._id}`)
        .set('Cookie', cookieDe(admin))
        .send({ ativo: false });
    expect(res.status).toBe(200);

    await esperar(150);
    expect(ws.caiu).toBe(true);
    expect(await socketsDa(prof)).toBe(0);
});

it('a exclusão da conta derruba o socket', async () => {
    const admin = await criarUsuario({ email: 'adm2.667@escola.test', perfil: 'admin' });
    const alvo = await criarUsuario({ email: 'alvo.667@escola.test', perfil: 'professor' });
    const ws = await conectarSocket(assinarTokenSessao(alvo));

    const res = await request(app)
        .delete(`/api/usuarios/${alvo._id}`)
        .set('Cookie', cookieDe(admin));
    expect(res.status).toBe(200);

    await esperar(150);
    expect(ws.caiu).toBe(true);
});

it('o logout derruba só o socket daquele token', async () => {
    const usuario = await criarUsuario({ email: 'dois.667@escola.test', perfil: 'diretor' });
    const tokenSaindo = assinarTokenSessao(usuario);
    const tokenOutraAba = assinarTokenSessao(usuario);
    const saindo = await conectarSocket(tokenSaindo);
    const outraAba = await conectarSocket(tokenOutraAba);

    const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', [`escola_jwt=${tokenSaindo}`]);
    expect(res.status).toBe(200);

    await esperar(150);
    expect(saindo.caiu).toBe(true);
    expect(outraAba.caiu).toBe(false);
    expect(await socketsDa(usuario)).toBe(1);
});

it('logout com token forjado não derruba a conexão de ninguém', async () => {
    const usuario = await criarUsuario({ email: 'forjado.667@escola.test', perfil: 'diretor' });
    const ws = await conectarSocket(assinarTokenSessao(usuario));
    const forjado = require('jsonwebtoken').sign({ id: String(usuario._id) }, 'outro-segredo');

    await request(app)
        .post('/api/auth/logout')
        .set('Cookie', [`escola_jwt=${forjado}`]);

    await esperar(150);
    expect(ws.caiu).toBe(false);
});
