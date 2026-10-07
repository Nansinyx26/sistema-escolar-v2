/**
 * @jest-environment jsdom
 */

/**
 * horarioEditorPerfil.test.js — Issue #656
 *
 * `checkDiretor()` do editor de horários devolvia `true` fixo: o botão de
 * edição, a paleta e o "Importar Excel" apareciam para qualquer perfil, e o
 * servidor recusava a gravação (PUT /api/config/:id é só de admin). Agora o
 * editor lê o perfil da sessão real e só mostra a edição a quem pode gravar.
 *
 * Issue #696: o "Sincronizar" (POST /api/tabela-geral/seed, só de admin) nunca
 * aparecia, nem para o admin: o editor procurava `btn-seed-db` e a página tem
 * `btn-seed-db-header`. Agora o botão usa o mesmo `data-so-quem-edita`.
 */

const fs = require('node:fs');
const path = require('node:path');

let HorarioEditor;

beforeAll(() => {
    require('../../../direcao/horario-editor.js');
    HorarioEditor = window.horarioEditor.constructor;
});

afterEach(() => {
    delete window.auth;
    delete window.db;
    document.body.innerHTML = '';
});

/** Dublê de js/auth.js: `/auth/me` responde `doServidor`; o cache, `doCache`. */
function sessao({ doServidor = null, doCache = null } = {}) {
    window.auth = {
        refreshCurrentUser: jest.fn().mockResolvedValue(doServidor),
        checkSession: jest.fn().mockResolvedValue(doCache),
        getCurrentUser: () => doCache,
    };
}

describe('checkPodeEditar', () => {
    it.each(['diretor', 'secretaria', 'professor', 'responsavel'])(
        '%s não edita (o servidor só grava de admin)',
        async (perfil) => {
            sessao({ doServidor: { perfil } });
            expect(await new HorarioEditor().checkPodeEditar()).toBe(false);
        }
    );

    it('admin edita', async () => {
        sessao({ doServidor: { perfil: 'Admin' } });
        expect(await new HorarioEditor().checkPodeEditar()).toBe(true);
    });

    it('o servidor manda: cache antigo de admin não vale se /auth/me diz outro perfil', async () => {
        sessao({ doServidor: { perfil: 'professor' }, doCache: { perfil: 'admin' } });
        expect(await new HorarioEditor().checkPodeEditar()).toBe(false);
    });

    it('sem rede, usa o cache da sessão', async () => {
        sessao({ doServidor: null, doCache: { perfil: 'admin' } });
        expect(await new HorarioEditor().checkPodeEditar()).toBe(true);
    });

    it('sem sessão nenhuma, não edita', async () => {
        sessao();
        expect(await new HorarioEditor().checkPodeEditar()).toBe(false);
        delete window.auth;
        expect(await new HorarioEditor().checkPodeEditar()).toBe(false);
    });
});

describe('init', () => {
    function pagina() {
        document.body.innerHTML = `
            <div class="header-actions"></div>
            <label for="input-excel" style="display:none" data-so-quem-edita>Importar Excel</label>
            <div id="editor-toolbar"></div>
            <div id="color-palette"></div>`;
        window.db = { getConfig: jest.fn().mockResolvedValue(null) };
        window.mostrarTabela = () => {};
    }

    it('professor não vê o botão de edição nem o Importar Excel', async () => {
        pagina();
        sessao({ doServidor: { perfil: 'professor' } });

        await new HorarioEditor().init();

        expect(document.getElementById('btn-toggle-edit')).toBeNull();
        expect(document.querySelector('[data-so-quem-edita]').style.display).toBe('none');
        expect(document.getElementById('color-palette').innerHTML).toBe('');
    });

    it('admin vê o botão de edição e o Importar Excel', async () => {
        pagina();
        sessao({ doServidor: { perfil: 'admin' } });

        await new HorarioEditor().init();

        expect(document.getElementById('btn-toggle-edit')).not.toBeNull();
        expect(document.querySelector('[data-so-quem-edita]').style.display).toBe('');
    });
});

describe('botões da página real (direcao/horario-jaguari.html)', () => {
    /** Só o cabeçalho de ações da página, como ela vai ao ar. */
    function paginaReal() {
        const html = fs.readFileSync(
            path.resolve(__dirname, '../../../direcao/horario-jaguari.html'),
            'utf8'
        );
        const doc = new DOMParser().parseFromString(html, 'text/html');
        document.body.innerHTML = doc.querySelector('.header-actions').outerHTML;
        window.db = { getConfig: jest.fn().mockResolvedValue(null) };
        window.mostrarTabela = () => {};
    }
    const sincronizar = () => document.querySelector('[data-acao="sincronizarHorario"]');
    const importar = () => document.querySelector('label[for="input-excel-header"]');

    it('admin vê o Sincronizar e o Importar Excel', async () => {
        paginaReal();
        sessao({ doServidor: { perfil: 'admin' } });
        expect(sincronizar().style.display).toBe('none');

        await new HorarioEditor().init();

        expect(sincronizar().style.display).toBe('');
        expect(importar().style.display).toBe('');
    });

    it('diretor não vê o Sincronizar nem o Importar Excel', async () => {
        paginaReal();
        sessao({ doServidor: { perfil: 'diretor' } });

        await new HorarioEditor().init();

        expect(sincronizar().style.display).toBe('none');
        expect(importar().style.display).toBe('none');
    });
});
