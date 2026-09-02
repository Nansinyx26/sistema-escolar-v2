/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://escola.test/html/secretaria/turma-alunos.html?turmaId=t-1"}
 */

/**
 * secretariaAutocompleteAluno.test.js — o autocomplete de aluno do modal
 * "Adicionar aluno" da Secretaria (Issue #190).
 *
 * POR QUE ESTE TESTE RODA EM jsdom E NÃO LÊ STRING
 * ------------------------------------------------
 * O que quebrou aqui não é markup: os ids batiam, o `role="combobox"` estava
 * declarado, o CSS já tinha a regra do item destacado. O que faltava era
 * COMPORTAMENTO — a seta não andava na lista, o Enter não escolhia, o Esc
 * fechava o formulário inteiro e a resposta de uma busca velha sobrescrevia a
 * lista da busca nova. Nada disso aparece lendo arquivo como texto; só
 * aparece teclando.
 *
 * Numa secretaria isso não é detalhe de conforto: o autocomplete é a única
 * defesa contra cadastrar de novo um aluno que já existe no banco. Quem não
 * consegue chegar na lista pelo teclado, ou vê o resultado errado por causa de
 * uma resposta atrasada, cadastra duplicado.
 *
 * O QUE É DUBLÊ E O QUE É REAL
 * ----------------------------
 * Dublê só o que atravessa a rede (`fetch`) e duas APIs que o jsdom não tem
 * (`matchMedia`, `scrollIntoView`). Toda a lógica de teclado, de destaque e de
 * descarte de resposta atrasada é a de produção, sem adaptação para o teste.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const PAGINA = path.join(RAIZ, 'html', 'secretaria', 'turma-alunos.html');
const TELA = path.join(RAIZ, 'js', 'secretaria-turma-alunos.js');

const DEBOUNCE_MS = 300;

const ANA = {
    id: 'a-1',
    nome: 'Ana Clara Souza',
    nomeExibicao: 'Ana Clara Souza',
    ra: '000000000001',
    raDigito: '1',
    raUf: 'SP',
    nascimentoFormatado: '10/03/2015',
    turmaAtual: '1A',
};
const BRUNO = {
    id: 'a-2',
    nome: 'Bruno Anastácio',
    nomeExibicao: 'Bruno Anastácio',
    ra: '000000000002',
    raDigito: '2',
    raUf: 'SP',
    nascimentoFormatado: '02/07/2015',
    turmaAtual: '1A',
};
const CARLA = {
    id: 'a-3',
    nome: 'Carla Andrade',
    nomeExibicao: 'Carla Andrade',
    ra: '000000000003',
    raDigito: '3',
    raUf: 'SP',
    nascimentoFormatado: '19/11/2015',
    turmaAtual: '1B',
};

// ─── Dublê de rede ───────────────────────────────────────────────────────────

/** Buscas que saíram e ainda não foram respondidas, na ordem em que saíram. */
let buscasPendentes = [];

/**
 * Se o aborto deve rejeitar a promessa do `fetch`.
 *
 * No navegador quase sempre rejeita — e é o caminho padrão deste dublê. Mas
 * existe a janela em que a resposta já chegou e está sendo lida quando o
 * aborto acontece: aí a promessa RESOLVE, com dado velho, depois que outra
 * busca já começou. É essa janela que o número de sequência do código de
 * produção protege, e é por isso que um teste desliga esta chave.
 */
let rejeitarAoAbortar = true;

function respostaOk(corpo) {
    return { ok: true, status: 200, json: () => Promise.resolve(corpo) };
}

function fetchDuble(url, opcoes) {
    const endereco = new URL(String(url), window.location.href);
    const caminho = endereco.pathname;

    if (caminho.endsWith('/secretaria/alunos/buscar')) {
        const termo = endereco.searchParams.get('q') || '';
        return new Promise((resolve, reject) => {
            const pendente = { termo, resolve, reject, abortada: false };
            const sinal = opcoes?.signal;
            if (sinal) {
                sinal.addEventListener('abort', () => {
                    pendente.abortada = true;
                    if (!rejeitarAoAbortar) return;
                    const erro = new Error('The operation was aborted.');
                    erro.name = 'AbortError';
                    reject(erro);
                });
            }
            buscasPendentes.push(pendente);
        });
    }

    if (caminho.endsWith('/alunos/importar/historico')) {
        return Promise.resolve(respostaOk({ success: true, data: { lotes: [] } }));
    }

    if (caminho.endsWith('/turmas/t-1/alunos')) {
        return Promise.resolve(
            respostaOk({
                success: true,
                data: {
                    turma: { nome: '1A', sala: '1A', periodo: 'Manhã' },
                    anoLetivo: 2026,
                    total: 0,
                    alunos: [],
                },
            })
        );
    }

    return Promise.resolve(respostaOk({ success: true, data: {} }));
}

/** Responde a busca mais antiga ainda pendente com a lista dada. */
function responderBusca(pendente, alunos) {
    pendente.resolve(respostaOk({ success: true, data: { alunos, total: alunos.length } }));
}

// ─── Utilidades da página ────────────────────────────────────────────────────

/**
 * O corpo REAL da página, sem os `<script>`.
 *
 * Remontar o formulário à mão aqui faria o teste passar para sempre, mesmo que
 * alguém tirasse o `role="listbox"` do `#listaBusca` ou apagasse o
 * `#statusBusca` — que é justamente o que não pode passar despercebido.
 */
function corpoDaPagina() {
    const html = fs.readFileSync(PAGINA, 'utf8');
    const corpo = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));
    return corpo.replace(/<script[\s\S]*?<\/script>/g, '');
}

function esperar(ms) {
    return new Promise((resolver) => setTimeout(resolver, ms));
}

/** Deixa as promessas já resolvidas assentarem no DOM. */
async function assentar() {
    for (let i = 0; i < 5; i++) {
        await Promise.resolve();
        await esperar(0);
    }
}

const campo = () => document.getElementById('buscaAluno');
const lista = () => document.getElementById('listaBusca');
const aviso = () => document.getElementById('avisoBusca');
const status = () => document.getElementById('statusBusca');
const opcoes = () => [...lista().children];

function textoDaOpcao(indice) {
    return opcoes()[indice].firstChild.textContent;
}

/** Índice do item marcado como ativo, ou -1. */
function indiceDestacado() {
    return opcoes().findIndex((item) => item.getAttribute('aria-selected') === 'true');
}

function digitar(texto) {
    campo().value = texto;
    campo().dispatchEvent(new window.Event('input', { bubbles: true }));
}

function teclar(key) {
    const evento = new window.KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
    });
    campo().dispatchEvent(evento);
    return evento;
}

/**
 * Digita, deixa o debounce vencer e devolve a busca que saiu.
 *
 * O debounce de 300 ms é de produção e roda com temporizador de verdade: o
 * arquivo instala os listeners no `DOMContentLoaded`, e trocar por timer falso
 * obrigaria a adaptar o carregamento da página só para o teste.
 */
async function buscar(termo) {
    digitar(termo);
    await esperar(DEBOUNCE_MS + 20);
    return buscasPendentes[buscasPendentes.length - 1];
}

/** Digita, responde e devolve com a lista já desenhada. */
async function buscarEResponder(termo, alunos) {
    const pendente = await buscar(termo);
    responderBusca(pendente, alunos);
    await assentar();
    return pendente;
}

/**
 * A página é carregada UMA vez para o arquivo inteiro, e cada teste recomeça
 * pelo botão "Adicionar aluno".
 *
 * Não é economia de tempo, é isolamento. O jsdom dá um `document` só por
 * arquivo de teste, e `js/secretaria-turma-alunos.js` instala tudo dentro do
 * `DOMContentLoaded`. Recarregando por teste — `jest.resetModules()` mais
 * `require` — cada cópia do módulo continua ouvindo o `DOMContentLoaded` no
 * `document`, que sobrevive à troca do `<body>`: no décimo teste, dez cópias
 * respondiam à mesma tecla, cada uma com seu próprio item destacado. Carregando
 * uma vez existe um módulo só, e um listener só por elemento.
 *
 * O `DOMContentLoaded` é disparado à mão porque no jsdom o documento do teste
 * já nasce `complete` — sozinho o evento nunca aconteceria, e a suíte passaria
 * com a tela morta, que é o pior tipo de teste verde.
 */
beforeAll(async () => {
    global.fetch = jest.fn(fetchDuble);
    window.fetch = global.fetch;

    // O jsdom não faz layout: nenhuma das duas existe nele. `fecharModal`
    // consulta `matchMedia` para saber quanto esperar pela transição de saída,
    // e o destaque por teclado chama `scrollIntoView` para trazer o item à
    // vista. Declarar movimento reduzido faz o fechamento ser imediato.
    window.matchMedia = (consulta) => ({
        media: consulta,
        matches: /prefers-reduced-motion/.test(consulta),
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        onchange: null,
        dispatchEvent: () => false,
    });
    window.Element.prototype.scrollIntoView = jest.fn();

    document.body.innerHTML = corpoDaPagina();
    require(TELA);
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await assentar();
});

afterAll(() => {
    delete global.fetch;
});

/**
 * Recomeça pelo botão que o usuário aperta. `limparFormulario` destrava os
 * campos, esvazia o termo e encerra a busca em curso — é o mesmo reset que a
 * tela faz em produção, não um atalho de teste.
 */
beforeEach(async () => {
    buscasPendentes = [];
    rejeitarAoAbortar = true;
    document.getElementById('btnAbrirAdicionar').click();
    await assentar();
    buscasPendentes = [];
});

// ─────────────────────────────────────────────────────────────────────────────

describe('autocomplete de aluno — o que aparece enquanto se digita', () => {
    it('não consulta o servidor com menos de 3 letras', async () => {
        digitar('an');
        await esperar(DEBOUNCE_MS + 20);

        expect(buscasPendentes).toHaveLength(0);
        expect(lista().hidden).toBe(true);

        // A terceira letra prova que a tela está viva: sem esta parte, o teste
        // continuaria verde com o autocomplete nunca instalado.
        await buscar('ana');
        expect(buscasPendentes).toHaveLength(1);
    });

    it('avisa que está buscando enquanto a resposta não chega', async () => {
        await buscar('ana');

        expect(aviso().hidden).toBe(false);
        expect(aviso().textContent).toBe('Buscando…');
        expect(campo().getAttribute('aria-busy')).toBe('true');
    });

    it('abre a lista com os alunos e anuncia quantos são', async () => {
        await buscarEResponder('ana', [ANA, BRUNO, CARLA]);

        expect(lista().hidden).toBe(false);
        expect(campo().getAttribute('aria-expanded')).toBe('true');
        expect(opcoes()).toHaveLength(3);
        expect(status().textContent).toBe('3 alunos encontrados.');
        // Com a lista na tela, repetir a contagem em texto visível seria ruído.
        expect(aviso().hidden).toBe(true);
        expect(campo().hasAttribute('aria-busy')).toBe(false);
    });

    it('sem resultado, a mensagem fica FORA do listbox', async () => {
        await buscarEResponder('zzz', []);

        // `role="listbox"` só admite `role="option"` como filho: um parágrafo
        // ali dentro quebra a leitura do widget inteiro.
        expect(lista().children).toHaveLength(0);
        expect(lista().hidden).toBe(true);
        expect(aviso().hidden).toBe(false);
        expect(aviso().textContent).toMatch(/Nenhum aluno encontrado/);
    });

    it('cada item é uma option não focável, nunca um botão', async () => {
        await buscarEResponder('ana', [ANA, BRUNO]);

        // Botão na lista entraria na ordem do Tab e roubaria o campo de texto
        // de quem navega por teclado — o foco tem que ficar no combobox.
        expect(lista().querySelectorAll('button')).toHaveLength(0);
        for (const item of opcoes()) {
            expect(item.getAttribute('role')).toBe('option');
            expect(item.hasAttribute('tabindex')).toBe(false);
            expect(item.id).toBeTruthy();
        }
    });

    it('apagar o termo fecha a lista e limpa o aviso', async () => {
        await buscarEResponder('ana', [ANA]);

        digitar('');
        await assentar();

        expect(lista().hidden).toBe(true);
        expect(lista().children).toHaveLength(0);
        expect(aviso().hidden).toBe(true);
        expect(campo().hasAttribute('aria-activedescendant')).toBe(false);
    });

    it('erro do servidor não deixa lista velha na tela', async () => {
        await buscarEResponder('ana', [ANA, BRUNO]);

        const pendente = await buscar('ana c');
        pendente.resolve({ ok: false, status: 500, json: () => Promise.resolve(null) });
        await assentar();

        expect(lista().hidden).toBe(true);
        expect(aviso().textContent).toMatch(/Não foi possível buscar/);
        // O resultado anterior vai junto: guardá-lo faria a seta para baixo
        // reabrir, depois do erro, uma lista que já não vale.
        expect(lista().children).toHaveLength(0);
        teclar('ArrowDown');
        expect(lista().hidden).toBe(true);
    });

    it('sair do campo cancela a consulta que ainda vinha', async () => {
        rejeitarAoAbortar = false;

        const pendente = await buscar('ana');
        campo().dispatchEvent(new window.Event('blur'));

        expect(pendente.abortada).toBe(true);

        responderBusca(pendente, [ANA, BRUNO]);
        await assentar();

        // Sem o cancelamento no `blur`, a lista reabriria sozinha sobre um
        // campo que o usuário já deixou para trás.
        expect(lista().hidden).toBe(true);
    });
});

describe('autocomplete de aluno — teclado', () => {
    it('a seta para baixo percorre a lista e volta ao topo na ponta', async () => {
        await buscarEResponder('ana', [ANA, BRUNO, CARLA]);

        teclar('ArrowDown');
        expect(indiceDestacado()).toBe(0);
        expect(campo().getAttribute('aria-activedescendant')).toBe(opcoes()[0].id);

        teclar('ArrowDown');
        teclar('ArrowDown');
        expect(indiceDestacado()).toBe(2);

        // Volta circular: da última, a próxima é a primeira.
        teclar('ArrowDown');
        expect(indiceDestacado()).toBe(0);
    });

    it('a seta para cima sem destaque começa pelo último', async () => {
        await buscarEResponder('ana', [ANA, BRUNO, CARLA]);

        teclar('ArrowUp');
        expect(indiceDestacado()).toBe(2);

        teclar('ArrowUp');
        expect(indiceDestacado()).toBe(1);
    });

    it('a seta impede o cursor de andar dentro do texto digitado', async () => {
        await buscarEResponder('ana', [ANA]);

        expect(teclar('ArrowDown').defaultPrevented).toBe(true);
    });

    it('Home e End pertencem ao cursor do texto, não à lista', async () => {
        await buscarEResponder('ana', [ANA, BRUNO, CARLA]);
        teclar('ArrowDown');

        // Combobox editável: sequestrar Home/End quebraria a edição do termo
        // (APG, combobox com autocomplete de lista).
        expect(teclar('Home').defaultPrevented).toBe(false);
        expect(teclar('End').defaultPrevented).toBe(false);
        expect(indiceDestacado()).toBe(0);
    });

    it('Enter escolhe o item destacado e trava os campos', async () => {
        await buscarEResponder('ana', [ANA, BRUNO]);

        teclar('ArrowDown');
        teclar('ArrowDown');
        const evento = teclar('Enter');

        // Sem `preventDefault` o Enter submeteria o formulário com o aluno
        // ainda não escolhido, e o cadastro sairia duplicado.
        expect(evento.defaultPrevented).toBe(true);
        expect(document.getElementById('campoNome').value).toBe(BRUNO.nome);
        expect(document.getElementById('campoRa').value).toBe(BRUNO.ra);
        expect(document.getElementById('campoNome').readOnly).toBe(true);
        expect(document.getElementById('rotuloSalvar').textContent).toBe('Vincular à turma');
        expect(lista().hidden).toBe(true);
    });

    it('Enter sem item destacado deixa o formulário seguir', async () => {
        await buscarEResponder('ana', [ANA]);

        expect(teclar('Enter').defaultPrevented).toBe(false);
        expect(document.getElementById('campoNome').value).toBe('');
    });

    it('a seta para baixo com a lista fechada reabre o último resultado', async () => {
        await buscarEResponder('ana', [ANA, BRUNO]);
        teclar('Escape');
        expect(lista().hidden).toBe(true);

        teclar('ArrowDown');

        expect(lista().hidden).toBe(false);
        expect(indiceDestacado()).toBe(0);
        // Reabrir o que já estava montado não gasta outra consulta ao banco.
        expect(buscasPendentes).toHaveLength(1);
    });
});

describe('autocomplete de aluno — Esc não pode custar o formulário', () => {
    it('com a lista aberta, Esc fecha só a lista', async () => {
        await buscarEResponder('ana', [ANA, BRUNO]);

        teclar('Escape');
        await assentar();

        expect(lista().hidden).toBe(true);
        expect(campo().getAttribute('aria-expanded')).toBe('false');
        // O modal fecha no Esc por um listener no `document`; quem só queria
        // fechar a lista não pode perder o que já digitou no formulário.
        expect(document.getElementById('modalAdicionar').hidden).toBe(false);
    });

    it('com a lista fechada, Esc fecha o modal', async () => {
        await buscarEResponder('ana', [ANA]);

        teclar('Escape'); // fecha a lista
        teclar('Escape'); // agora é do modal
        await assentar();

        expect(document.getElementById('modalAdicionar').hidden).toBe(true);
    });
});

describe('autocomplete de aluno — mouse e teclado apontam o mesmo item', () => {
    it('passar o mouse move o destaque, e o Enter escolhe esse item', async () => {
        await buscarEResponder('ana', [ANA, BRUNO, CARLA]);

        teclar('ArrowDown');
        expect(indiceDestacado()).toBe(0);

        opcoes()[2].dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
        expect(indiceDestacado()).toBe(2);
        expect(campo().getAttribute('aria-activedescendant')).toBe(opcoes()[2].id);

        teclar('Enter');
        expect(document.getElementById('campoNome').value).toBe(CARLA.nome);
    });

    it('o clique continua escolhendo o aluno', async () => {
        await buscarEResponder('ana', [ANA, BRUNO]);

        expect(textoDaOpcao(0)).toBe(ANA.nomeExibicao);
        opcoes()[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await assentar();

        expect(document.getElementById('campoNome').value).toBe(ANA.nome);
        expect(lista().hidden).toBe(true);
    });

    it('o mousedown na lista não deixa o campo perder o foco', async () => {
        await buscarEResponder('ana', [ANA]);

        const evento = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
        opcoes()[0].dispatchEvent(evento);

        // Sem isto o `blur` fecharia a lista antes de o `click` acontecer — era
        // o que a espera artificial de 150 ms remendava.
        expect(evento.defaultPrevented).toBe(true);
    });
});

describe('autocomplete de aluno — resposta atrasada não sobrescreve a nova', () => {
    it('a consulta anterior é abortada quando outra começa', async () => {
        const primeira = await buscar('ana');
        const segunda = await buscar('ana c');

        expect(primeira.abortada).toBe(true);
        expect(segunda.abortada).toBe(false);
        expect(segunda.termo).toBe('ana c');
    });

    it('resposta velha que escapa do aborto é descartada', async () => {
        // Reproduz a janela real: a resposta já estava sendo lida quando o
        // aborto chegou, então ela RESOLVE — fora de ordem, com dado velho.
        rejeitarAoAbortar = false;

        const primeira = await buscar('ana');
        const segunda = await buscar('ana c');

        // A nova responde primeiro; a velha chega depois, como no cold start.
        responderBusca(segunda, [ANA]);
        await assentar();
        responderBusca(primeira, [BRUNO, CARLA]);
        await assentar();

        expect(opcoes()).toHaveLength(1);
        expect(textoDaOpcao(0)).toBe(ANA.nomeExibicao);
        expect(status().textContent).toBe('1 aluno encontrado.');
    });

    it('apagar o termo descarta a resposta que ainda vinha', async () => {
        rejeitarAoAbortar = false;

        const pendente = await buscar('ana');
        digitar('');
        await assentar();

        responderBusca(pendente, [ANA, BRUNO]);
        await assentar();

        expect(lista().hidden).toBe(true);
        expect(lista().children).toHaveLength(0);
    });
});
