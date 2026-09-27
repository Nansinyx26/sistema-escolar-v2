/**
 * @jest-environment jsdom
 */

/**
 * Conta de responsável que volta à tela de login da escola.
 *
 * O BUG
 * O responsável entrava no portal e, voltando para `login-professor.html`,
 * a página via a sessão aberta e perguntava `auth.hasProfile()`. Essa função
 * só diz "sim" para admin, professor e diretor — então o responsável caía em
 * `escolher-perfil.html`, com os cartões "Professor" e "Diretor" à escolha.
 *
 * A REGRA
 * Sessão aberta vai para o painel do PRÓPRIO perfil, o mesmo destino que o
 * servidor dá depois do login (`utils/painelPorPerfil.js`). A tela de escolha
 * é só de quem ainda não tem perfil.
 */

const path = require('node:path');
const { PAINEL_POR_PERFIL, PAINEL_SEM_PERFIL } = require('../utils/painelPorPerfil');

const RAIZ = path.resolve(__dirname, '../../..');
const AUTH = path.join(RAIZ, 'js', 'auth.js');
const LOGIN = path.join(RAIZ, 'js', 'login.js');
const ESCOLHER_PERFIL = path.join(RAIZ, 'js', 'escolher-perfil.js');

function authCom(usuario) {
    jest.isolateModules(() => require(AUTH));
    const auth = window.auth;
    auth.currentUser = usuario;
    return auth;
}

/** Roda o DOMContentLoaded de um script de página com a sessão dada. */
async function abrirPaginaComSessao(script, usuario) {
    delete window.location;
    window.location = { href: '', search: '' };
    const auth = authCom(usuario);
    auth.init = jest.fn().mockResolvedValue(undefined);
    global.auth = auth;
    global.db = { init: jest.fn().mockResolvedValue(undefined) };

    const ouvintes = [];
    const original = document.addEventListener;
    document.addEventListener = (tipo, fn) => {
        if (tipo === 'DOMContentLoaded') ouvintes.push(fn);
    };
    try {
        jest.isolateModules(() => require(script));
    } finally {
        document.addEventListener = original;
    }
    for (const fn of ouvintes) await fn();
    return window.location.href;
}

// A tabela do servidor já é cobrada contra o enum de `models/Usuario.js` em
// `painelPorPerfil.test.js` — o mongoose não carrega sob jsdom.
describe('auth.painelDoUsuario espelha o destino do servidor', () => {
    it.each(Object.keys(PAINEL_POR_PERFIL))(
        '%s vai para o mesmo painel que o login dá',
        (perfil) => {
            expect(authCom({ perfil }).painelDoUsuario()).toBe(PAINEL_POR_PERFIL[perfil]);
        }
    );

    it('conta sem perfil vai para a escolha de perfil', () => {
        expect(authCom({ nome: 'Sem perfil' }).painelDoUsuario()).toBe(PAINEL_SEM_PERFIL);
    });

    it('responsável nunca cai na escolha de Professor/Diretor', () => {
        expect(authCom({ perfil: 'responsavel' }).painelDoUsuario()).not.toBe(PAINEL_SEM_PERFIL);
    });
});

describe('tela de login com sessão já aberta', () => {
    it('responsável é levado ao portal, não à escolha de perfil', async () => {
        const destino = await abrirPaginaComSessao(LOGIN, { perfil: 'responsavel' });
        expect(destino).toBe(PAINEL_POR_PERFIL.responsavel);
    });

    it('secretaria é levada ao painel dela', async () => {
        const destino = await abrirPaginaComSessao(LOGIN, { perfil: 'secretaria' });
        expect(destino).toBe(PAINEL_POR_PERFIL.secretaria);
    });

    it('professor continua indo ao dashboard', async () => {
        const destino = await abrirPaginaComSessao(LOGIN, { perfil: 'professor' });
        expect(destino).toBe(PAINEL_POR_PERFIL.professor);
    });
});

describe('escolher-perfil.html aberta direto', () => {
    it('responsável não vê a escolha de Professor/Diretor', async () => {
        const destino = await abrirPaginaComSessao(ESCOLHER_PERFIL, { perfil: 'responsavel' });
        expect(destino).toBe(PAINEL_POR_PERFIL.responsavel);
    });

    it('conta sem perfil continua na tela de escolha', async () => {
        const destino = await abrirPaginaComSessao(ESCOLHER_PERFIL, { nome: 'Nova' });
        expect(destino).toBe('');
    });
});
