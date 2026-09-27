/**
 * handshakeSocket.regressao.test.js — Issue #488
 *
 * O handshake do Socket.IO passa a seguir as mesmas regras de sessão do
 * authJWT: token encerrado no logout não reconecta, e só token de sessão abre
 * conexão. As regras que já valiam (conta ativa, tokenVersion) continuam.
 */
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const JWT_SECRET = require('../utils/jwtConfig');
const { assinarTokenSessao, revogarTokenSessao } = require('../utils/sessionToken');
const { criarAutenticacaoSocket } = require('../realtime/autenticarSocket');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

const autenticar = criarAutenticacaoSocket(JWT_SECRET);

function socketCom(token) {
    return { handshake: { auth: { token }, headers: {}, query: {} }, data: {} };
}

/** Roda o middleware e devolve a mensagem de erro, ou null quando conecta. */
async function conectar(token) {
    const socket = socketCom(token);
    const erro = await new Promise((resolve) => {
        autenticar(socket, (e) => resolve(e || null));
    });
    return { socket, erro: erro ? erro.message : null };
}

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
});

describe('handshake do Socket.IO', () => {
    it('sessão válida conecta, com o perfil lido do banco e a credencial apagada', async () => {
        const prof = await criarUsuario({ email: 'prof.socket@escola.test', perfil: 'professor' });
        const { socket, erro } = await conectar(assinarTokenSessao(prof));

        expect(erro).toBeNull();
        expect(socket.user.perfil).toBe('professor');
        expect(socket.handshake.auth.token).toBeUndefined();
    });

    it('token encerrado no logout não reconecta', async () => {
        const prof = await criarUsuario({ email: 'prof.logout@escola.test', perfil: 'professor' });
        const token = assinarTokenSessao(prof);

        const logout = await revogarTokenSessao(token);
        expect(logout.escopo).toBe('token');

        const { erro } = await conectar(token);
        expect(erro).toBe('Session revoked');
    });

    it('outra sessão da mesma conta continua conectando depois do logout de uma', async () => {
        const prof = await criarUsuario({ email: 'prof.duas@escola.test', perfil: 'professor' });
        await revogarTokenSessao(assinarTokenSessao(prof));

        const { erro } = await conectar(assinarTokenSessao(prof));
        expect(erro).toBeNull();
    });

    it('token que não é de sessão não conecta, mesmo trazendo o id da conta', async () => {
        const prof = await criarUsuario({ email: 'prof.preauth@escola.test', perfil: 'professor' });
        // Com `id` presente, a busca da conta encontraria o usuário: só a
        // checagem do propósito barra este token.
        const preAuth = jwt.sign(
            { id: String(prof._id), sub: String(prof._id), purpose: 'pre-auth', jti: 'preauth-1' },
            JWT_SECRET,
            { expiresIn: 300 }
        );

        const { erro } = await conectar(preAuth);
        expect(erro).toBe('Invalid authentication token');
    });

    it('troca de tokenVersion continua derrubando a sessão', async () => {
        const prof = await criarUsuario({ email: 'prof.versao@escola.test', perfil: 'professor' });
        const token = assinarTokenSessao(prof);
        await Usuario.updateOne({ _id: prof._id }, { $inc: { tokenVersion: 1 } });

        const { erro } = await conectar(token);
        expect(erro).toBe('Session revoked');
    });

    it('conta desativada continua sem conectar', async () => {
        const prof = await criarUsuario({ email: 'prof.inativo@escola.test', perfil: 'professor' });
        const token = assinarTokenSessao(prof);
        await Usuario.updateOne({ _id: prof._id }, { $set: { ativo: false } });

        const { erro } = await conectar(token);
        expect(erro).toBe('Account disabled');
    });

    it('sem token, recusa', async () => {
        const { erro } = await conectar(undefined);
        expect(erro).toBe('Authentication required');
    });
});
