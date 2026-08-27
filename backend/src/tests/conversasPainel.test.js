/**
 * @jest-environment jsdom
 */

/**
 * conversasPainel.test.js — a conversa ancorada no painel da página de
 * conversas (Issue da correção do layout estilo WhatsApp Web).
 *
 * POR QUE ESTE ARQUIVO NÃO É MAIS UM TESTE DE STRING
 * --------------------------------------------------
 * `paginaConversas.test.js` verifica o CONTRATO entre a página e o manager
 * lendo os dois arquivos como texto — é o que cabe a um HTML servido
 * estático. O defeito corrigido aqui não aparece nesse nível: os dois lados
 * continuavam se encontrando, os ids batiam, nada quebrava no console. O que
 * estava errado era o COMPORTAMENTO — clicar num segundo contato deixava a
 * conversa do primeiro na tela, e quem escrevia achava que estava falando com
 * a pessoa que acabara de clicar.
 *
 * Num chat de escola isso não é incômodo de layout: é assunto de aluno indo
 * para o contato errado. Só um teste que de fato CLICA pega esse caso, então
 * esta suíte roda em jsdom, carrega os dois arquivos de verdade
 * (`js/chat-direto-manager.js` e `js/conversas.js`) sobre o corpo real de
 * `html/conversas.html`, e clica.
 *
 * O QUE É DUBLÊ E O QUE É REAL
 * ----------------------------
 * Dublê apenas o que atravessa a rede (`fetch`) e o Socket.IO. A lógica que
 * decide quantas janelas ficam abertas, onde elas nascem e o que acontece ao
 * fechar é a de produção, sem adaptação nenhuma para o teste.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const PAGINA = path.join(RAIZ, 'html', 'conversas.html');
const MANAGER = path.join(RAIZ, 'js', 'chat-direto-manager.js');
const LISTA = path.join(RAIZ, 'js', 'conversas.js');

const CONTATOS = [
    {
        id: 'prof-1',
        nome: 'Ana Lima',
        perfil: 'professor',
        presenca: { status: 'online', texto: 'online' },
        naoLidas: 0,
    },
    {
        id: 'prof-2',
        nome: 'Bruno Sá',
        perfil: 'diretor',
        presenca: { status: 'offline', texto: 'offline' },
        naoLidas: 3,
    },
];

/** Resposta mínima no formato que os dois arquivos esperam de `fetch`. */
function resposta(corpo) {
    return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(corpo),
    });
}

function fetchDublê(url) {
    const u = String(url);
    if (u.includes('/chat-direto/contatos')) {
        // Cópia: a tela mexe em `naoLidas` do objeto que recebe, e um teste não
        // pode contaminar o seguinte.
        return resposta({ success: true, data: JSON.parse(JSON.stringify(CONTATOS)) });
    }
    if (u.includes('/chat-direto/historico/')) {
        return resposta({ success: true, data: [], hasMore: false });
    }
    if (u.includes('/chat-direto/presenca/')) {
        return resposta({ success: true, data: { status: 'offline', ultimoAcesso: null } });
    }
    return resposta({ success: true });
}

/**
 * O corpo REAL da página, sem os `<script>`.
 *
 * Remontar o esqueleto à mão aqui faria o teste passar para sempre, mesmo que
 * alguém renomeasse `#convVazio` ou tirasse o `#chatWindowsContainer` de
 * dentro do painel — que é justamente o que não pode acontecer sem ninguém
 * perceber. `innerHTML` não executa `<script>`, mas eles saem do markup do
 * mesmo jeito para não deixar tag inerte confundindo quem lê uma falha.
 */
function corpoDaPagina() {
    const html = fs.readFileSync(PAGINA, 'utf8');
    const corpo = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));
    return corpo.replace(/<script[\s\S]*?<\/script>/g, '');
}

/** Deixa as promessas de `fetch` já resolvidas assentarem no DOM. */
async function assentar() {
    for (let i = 0; i < 5; i++) {
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
    }
}

function janelasAbertas() {
    return [...document.querySelectorAll('.chat-window')];
}

/**
 * O jsdom não faz layout, então não implementa `matchMedia` — sem este dublê a
 * chamada nem existe como função. O manager consulta `(max-width: 768px)` para
 * decidir se está no celular, onde a janela ocupa a tela toda e várias abertas
 * se empilhariam invisíveis. Cada teste declara em qual das duas telas está.
 */
function simularTela(tipo) {
    const celular = tipo === 'celular';
    window.matchMedia = (consulta) => ({
        media: consulta,
        matches: /max-width:\s*768px/.test(consulta) ? celular : !celular,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        onchange: null,
        dispatchEvent: () => false,
    });
}

function itemDoContato(id) {
    return document.querySelector(`.conv-item[data-id="${id}"]`);
}

beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';

    global.fetch = jest.fn(fetchDublê);
    window.fetch = global.fetch;
    simularTela('desktop');

    // Sem um socket com `.on`, os dois arquivos ficam reagendando a tentativa
    // de conexão com `setTimeout` até o fim da suíte. O dublê encerra a busca
    // na primeira tentativa; nenhum teste daqui depende de evento de socket.
    window.socket = { on: jest.fn() };

    sessionStorage.setItem('currentUser', JSON.stringify({ id: 'eu-mesmo' }));
});

afterEach(() => {
    delete global.fetch;
    delete window.socket;
    delete window.chatManager;
    delete window.abrirChatCom;
    sessionStorage.clear();
    localStorage.clear();
});

/**
 * Carrega a página como o navegador carregaria: markup primeiro, depois os
 * dois scripts na ordem em que o HTML os declara.
 *
 * A ordem importa e não é detalhe de teste: `conversas.js` guarda referências
 * do DOM no momento em que executa e liga o modo painel no `window.chatManager`
 * que o manager já criou. Inverter aqui esconderia uma quebra real.
 */
async function abrirAPagina() {
    document.body.innerHTML = corpoDaPagina();
    require(MANAGER);
    require(LISTA);
    if (document.readyState === 'loading') {
        document.dispatchEvent(new window.Event('DOMContentLoaded'));
    }
    await assentar();
}

// ─────────────────────────────────────────────────────────────────────────────

describe('página de conversas — a conversa vive no painel', () => {
    it('a lista carrega e ainda não há conversa aberta', async () => {
        await abrirAPagina();

        expect(document.querySelectorAll('.conv-item')).toHaveLength(CONTATOS.length);
        expect(janelasAbertas()).toHaveLength(0);
        // O convite "escolha um contato" é o estado inicial do painel.
        expect(document.getElementById('convVazio').style.display).not.toBe('none');
    });

    it('a conversa nasce dentro do painel, não solta no corpo da página', async () => {
        await abrirAPagina();
        itemDoContato('prof-1').click();
        await assentar();

        const [janela] = janelasAbertas();
        expect(janela).toBeDefined();

        // É isto que faz a conversa ocupar o painel em vez de flutuar sobre a
        // tela: o manager só reaproveita o container quando ele já existe no
        // HTML — ver createContainer().
        const container = janela.parentElement;
        expect(container.id).toBe('chatWindowsContainer');
        expect(container.closest('.conv-painel')).not.toBeNull();
    });

    it('abrir um segundo contato FECHA a conversa anterior', async () => {
        await abrirAPagina();

        itemDoContato('prof-1').click();
        await assentar();
        expect(janelasAbertas().map((j) => j.id)).toEqual(['chatWindow_prof-1']);

        itemDoContato('prof-2').click();
        await assentar();

        // O defeito: as duas janelas coexistiam e a visível continuava sendo a
        // primeira. No painel só cabe uma, e ela é a de quem foi clicado.
        expect(janelasAbertas().map((j) => j.id)).toEqual(['chatWindow_prof-2']);
        expect(document.getElementById('chatWindow_prof-1')).toBeNull();
    });

    it('a lista marca como atual exatamente o contato que está aberto', async () => {
        await abrirAPagina();

        itemDoContato('prof-1').click();
        await assentar();
        expect(itemDoContato('prof-1').getAttribute('aria-current')).toBe('true');

        itemDoContato('prof-2').click();
        await assentar();

        const marcados = [...document.querySelectorAll('.conv-item[aria-current="true"]')];
        expect(marcados.map((b) => b.dataset.id)).toEqual(['prof-2']);
    });

    it('fechar a conversa devolve o painel ao convite e desmarca o contato', async () => {
        await abrirAPagina();
        itemDoContato('prof-1').click();
        await assentar();

        expect(document.getElementById('convVazio').style.display).toBe('none');

        document.getElementById('btnClose_prof-1').click();
        await assentar();

        expect(janelasAbertas()).toHaveLength(0);
        expect(document.getElementById('convVazio').style.display).not.toBe('none');
        expect(document.querySelector('.conv-item[aria-current="true"]')).toBeNull();
    });

    it('trocar de contato não repõe o convite por cima da conversa que entrou', async () => {
        await abrirAPagina();

        itemDoContato('prof-1').click();
        await assentar();
        itemDoContato('prof-2').click();
        await assentar();

        // Trocar de contato fecha a janela anterior, e o fechamento avisa a
        // página. Se a página tratasse esse aviso sem olhar de QUEM ele é, o
        // convite voltaria bem em cima da conversa recém-aberta.
        expect(document.getElementById('convVazio').style.display).toBe('none');
        expect(janelasAbertas()).toHaveLength(1);
    });
});

/**
 * O manager é compartilhado: as outras 60+ páginas usam o mesmo arquivo para o
 * chat FLUTUANTE, onde abrir uma segunda conversa ao lado da primeira é o
 * comportamento correto. A correção não podia custar isso.
 */
describe('chat flutuante das demais páginas — sem regressão', () => {
    it('fora do modo painel, duas conversas ficam abertas lado a lado', async () => {
        require(MANAGER);
        if (document.readyState === 'loading') {
            document.dispatchEvent(new window.Event('DOMContentLoaded'));
        }
        await assentar();

        expect(window.chatManager.modoPainel).toBe(false);

        window.abrirChatCom('prof-1', { nome: 'Ana Lima' });
        window.abrirChatCom('prof-2', { nome: 'Bruno Sá' });
        await assentar();

        expect(janelasAbertas()).toHaveLength(2);
        // E o container é o que o próprio manager cria, preso ao body.
        expect(document.getElementById('chatWindowsContainer').parentElement).toBe(document.body);
    });

    it('no celular continua valendo a regra antiga: uma conversa por vez', async () => {
        simularTela('celular');
        require(MANAGER);
        if (document.readyState === 'loading') {
            document.dispatchEvent(new window.Event('DOMContentLoaded'));
        }
        await assentar();

        // Aqui a janela ocupa a tela inteira; duas abertas seriam duas conversas
        // empilhadas uma sobre a outra, sem nada indicando qual está por baixo.
        // Esta regra é anterior à correção e não podia sair junto com ela.
        expect(window.chatManager.modoPainel).toBe(false);
        window.abrirChatCom('prof-1', { nome: 'Ana Lima' });
        window.abrirChatCom('prof-2', { nome: 'Bruno Sá' });
        await assentar();

        expect(janelasAbertas().map((j) => j.id)).toEqual(['chatWindow_prof-2']);
    });

    it('o modo painel é opt-in e vale para as duas páginas de conversas', async () => {
        require(MANAGER);
        if (document.readyState === 'loading') {
            document.dispatchEvent(new window.Event('DOMContentLoaded'));
        }
        await assentar();

        window.chatManager.setModoPainel(true);
        window.abrirChatCom('prof-1', { nome: 'Ana Lima' });
        window.abrirChatCom('prof-2', { nome: 'Bruno Sá' });
        await assentar();

        expect(janelasAbertas()).toHaveLength(1);
    });
});

/**
 * A altura e a largura da conversa ancorada só existem no CSS, e o jsdom não
 * resolve folha externa nem media query — `getComputedStyle` aqui devolveria
 * o mesmo valor com ou sem a correção. Então este bloco lê o CSS como texto,
 * de propósito, e guarda apenas o que uma regressão silenciosa desfaria.
 *
 * O risco é concreto: `css/chat-flutuante.css` declara `.chat-window` com
 * 360×520px, e ainda reduz para 460px de altura em notebook
 * (`min-width:769px and max-height:700px`) e 320px de largura em tablet
 * (`max-width:1024px`). Todas essas regras continuam valendo nesta página —
 * era o que fazia a conversa aparecer como um retângulo no canto do painel.
 */
describe('o CSS da página impede a conversa de voltar a ser uma janelinha', () => {
    const PAGINAS = [
        path.join(RAIZ, 'html', 'conversas.html'),
        path.join(RAIZ, 'html', 'direcao', 'conversas.html'),
    ];

    it.each(PAGINAS)('%s ancora a conversa em 100%% do painel', (arquivo) => {
        const html = fs.readFileSync(arquivo, 'utf8');
        const regra = html.match(/\.conv-painel \.chat-window \{([\s\S]*?)\}/);

        expect(regra).not.toBeNull();
        // `!important` porque as regras da janela flutuante empatam em
        // especificidade dentro das media queries que ainda valem aqui.
        expect(regra[1]).toMatch(/width:\s*100%\s*!important/);
        expect(regra[1]).toMatch(/height:\s*100%\s*!important/);
    });

    it.each(PAGINAS)('%s dá ao painel a largura que sobra da lista', (arquivo) => {
        const html = fs.readFileSync(arquivo, 'utf8');

        // `minmax(0, 1fr)` e não `1fr`: o mínimo automático de `1fr` é
        // min-content, e o cabeçalho da conversa empurrava a coluna da direita
        // até espremer a faixa de contatos.
        expect(html).toMatch(/grid-template-columns:[^;]*minmax\(0,\s*1fr\)/);
    });
});
