/**
 * autenticarSocket.js — autenticação do handshake do Socket.IO.
 *
 * Saiu do `index.js` para ser testável (Issue #488) e para seguir as MESMAS
 * regras do `authJWT` nas rotas HTTP. Antes, o handshake conferia conta ativa
 * e `tokenVersion`, mas:
 *
 *  - não consultava a lista de tokens encerrados no logout: uma sessão
 *    encerrada continuava abrindo conexão em tempo real enquanto a versão da
 *    conta fosse a mesma;
 *  - não conferia o propósito do token. O token intermediário do 2FA
 *    (`purpose: 'pre-auth'`) é assinado com o mesmo segredo; hoje ele é barrado
 *    só porque traz o id em `sub` e a busca da conta volta vazia. A regra
 *    passa a ser explícita, e não um efeito do nome de um campo.
 */
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const { tokenEstaRevogado } = require('../utils/sessionToken');
const { vinculosDoUsuario } = require('../middleware/filtrarPorEscola');
const { apagarCredenciaisDoHandshake } = require('./adapter');

function tokenDoHandshake(socket) {
    return (
        socket.handshake.auth?.token ||
        socket.handshake.headers?.cookie?.match(/escola_jwt=([^;]+)/)?.[1] ||
        socket.handshake.query?.token
    );
}

function criarAutenticacaoSocket(JWT_SECRET) {
    return async function autenticarSocket(socket, next) {
        try {
            const token = tokenDoHandshake(socket);
            if (!token) {
                return next(new Error('Authentication required'));
            }

            const decoded = jwt.verify(token, JWT_SECRET);

            // Mesma regra do authJWT: só token de sessão abre conexão.
            if (decoded.purpose && decoded.purpose !== 'session') {
                return next(new Error('Invalid authentication token'));
            }

            // Logout real: o jti encerrado não reconecta. A consulta falha
            // fechado (erro de banco conta como revogado).
            if (await tokenEstaRevogado(decoded)) {
                return next(new Error('Session revoked'));
            }

            const conta = await Usuario.findById(decoded.id || decoded._id)
                .select('tokenVersion ativo perfil escolaId superAdmin')
                .lean();

            if (!conta || conta.ativo === false) {
                return next(new Error('Account disabled'));
            }

            const versaoConta = conta.tokenVersion !== undefined ? conta.tokenVersion : 0;
            const versaoToken = decoded.tokenVersion !== undefined ? decoded.tokenVersion : 0;
            if (versaoConta !== versaoToken) {
                return next(new Error('Session revoked'));
            }

            // Perfil vem do BANCO, não do token: um rebaixamento vale na hora
            socket.user = { ...decoded, perfil: conta.perfil };

            // Escola do socket — base do isolamento multi-tenant no realtime
            let escolaId = conta.escolaId ? String(conta.escolaId) : null;
            if (!escolaId) {
                const vinculos = await vinculosDoUsuario({
                    id: conta._id,
                    email: decoded.email,
                    perfil: conta.perfil,
                });
                if (vinculos.length === 1) escolaId = String(vinculos[0].escolaId);
            }
            socket.escolaId = escolaId;

            // Escola bloqueada pelo super admin (Issue #463): sem isto, o
            // cliente desconectado no bloqueio voltaria na reconexão
            // automática. `socket.data` (e não uma propriedade solta) porque
            // é o que `fetchSockets()` enxerga nas OUTRAS instâncias — o
            // desconectarEscola precisa saber quem é super admin para poupá-lo.
            const usuarioSocket = {
                perfil: conta.perfil,
                superAdmin: conta.superAdmin === true,
            };
            socket.data.usuario = usuarioSocket;
            const escolaBloqueio = require('../services/escolaBloqueio');
            if (await escolaBloqueio.escolaBloqueadaPara(usuarioSocket, [escolaId])) {
                return next(new Error(escolaBloqueio.CODIGO));
            }

            apagarCredenciaisDoHandshake(socket);

            next();
        } catch {
            next(new Error('Invalid authentication token'));
        }
    };
}

module.exports = { criarAutenticacaoSocket };
