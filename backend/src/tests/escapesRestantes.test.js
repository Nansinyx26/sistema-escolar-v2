/**
 * @jest-environment jsdom
 */

/**
 * escapesRestantes.test.js — Issue #650
 *
 * Mesma classe do #631, #634 e #639, nas telas que faltavam: turma do
 * professor (js/app.js), autorizações da secretaria, código do aluno,
 * frequência dos professores, seleção de turma, toast em tempo real e reação
 * do chat. Onde dá, o teste roda a função de render real; onde a função
 * depende da página inteira, confere que o padrão sem escape não voltou.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const TAG = '<img src=x onerror="window.__xss=1">';

/** Texto de `function nome(...) { ... }` (ou do método `nome(...) {`). */
function textoDaFuncao(rel, nome, { metodo = false } = {}) {
    const src = fonte(rel);
    const marca = metodo ? `    ${nome}(` : `function ${nome}(`;
    const inicio = src.indexOf(marca);
    if (inicio < 0) throw new Error(`${rel} não declara ${nome}`);
    let profundidade = 0;
    let fim = src.indexOf('{', inicio);
    for (; fim < src.length; fim++) {
        if (src[fim] === '{') profundidade++;
        if (src[fim] === '}' && --profundidade === 0) break;
    }
    return src.slice(inicio, fim + 1);
}

function semElementoDoDado(container) {
    expect(container.querySelector('img, script, svg, iframe')).toBeNull();
    for (const el of container.querySelectorAll('*')) {
        for (const attr of el.getAttributeNames()) expect(attr.startsWith('on')).toBe(false);
    }
    expect(window.__xss).toBeUndefined();
}

afterEach(() => {
    delete window.__xss;
    document.body.innerHTML = '';
});

describe('autorizações da secretaria (js/autorizacoes-alunos.js)', () => {
    it('nome, RA, turma, responsável e e-mail aparecem como texto', () => {
        document.body.innerHTML = '<table><tbody id="corpo"></tbody></table>';
        const REL = 'js/autorizacoes-alunos.js';
        const corpo = ['escAttr', 'renderBadgeStatus', 'formatarData', 'renderTabela']
            .map((n) => textoDaFuncao(REL, n))
            .join('\n');
        // eslint-disable-next-line no-new-func
        const renderTabela = new Function(
            'state',
            'dom',
            `const textoHtml = escAttr;\n${corpo}\nreturn renderTabela;`
        )(
            {
                alunosFiltrados: [
                    {
                        id: 'a1" data-x="1',
                        nome: `${TAG}Ana`,
                        matricula: TAG,
                        turma: TAG,
                        responsavel: TAG,
                        responsavelEmail: `x${TAG}@x.test`,
                        aceitas: TAG,
                        naoAceitas: 0,
                        statusGeral: 'parcial',
                    },
                ],
                paginacao: { paginaAtual: 1, itensPorPagina: 10 },
            },
            { corpoTabela: document.getElementById('corpo') }
        );

        renderTabela();

        const tbody = document.getElementById('corpo');
        semElementoDoDado(tbody);
        expect(tbody.textContent).toContain(`${TAG}Ana`);
        expect(tbody.querySelector('tr').getAttributeNames()).toEqual(['data-aluno-id']);
    });

    it('condutor e medicamento informados pelo responsável passam pelo textoHtml', () => {
        const src = fonte('js/autorizacoes-alunos.js');
        for (const campo of [
            'motoristaNome',
            'motoristaTelefone',
            'medicamentoNome',
            'medicamentoDose',
        ]) {
            expect(src).not.toMatch(
                new RegExp(`\\$\\{auth\\.detalhes\\.${campo}( \\|\\|[^}]*)?\\}`)
            );
        }
    });
});

describe('seleção de turma (js/selecionar.js)', () => {
    it('nome do professor e dados da turma aparecem como texto', () => {
        const REL = 'js/selecionar.js';
        const metodo = ['getIcon', 'renderTurmaCard']
            .map((n) => textoDaFuncao(REL, n, { metodo: true }))
            .join(',\n');
        window.getPhotoUrl = (f) => f;
        // eslint-disable-next-line no-new-func
        const pagina = new Function(`${textoDaFuncao(REL, 'escAttr')}\nreturn { ${metodo} };`)();

        document.body.innerHTML = `<div id="g">${pagina.renderTurmaCard(
            { id: '5A', ano: TAG, sala: 'A', turno: TAG },
            { principal: { nome: `${TAG}Ana` }, outros: [{ nome: TAG }] }
        )}</div>`;

        const g = document.getElementById('g');
        semElementoDoDado(g);
        expect(g.textContent).toContain(`${TAG}Ana`);
        delete window.getPhotoUrl;
    });
});

describe('toast em tempo real (js/realtime.js)', () => {
    it('título e resumo da notificação chegam ao toast escapados', () => {
        const REL = 'js/realtime.js';
        const corpo = ['textoHtml', 'resumirTexto', 'showNotifPopup']
            .map((n) => textoDaFuncao(REL, n))
            .join('\n');
        let mensagem = '';
        // eslint-disable-next-line no-new-func
        const showNotifPopup = new Function(
            'showToast',
            'mostrarNotificacaoDoSistema',
            `${corpo}\nreturn showNotifPopup;`
        )(
            (m) => {
                mensagem = m;
            },
            () => {}
        );

        // `resumirTexto` só tira tag fechada: sem o `>` final, a tag passava.
        showNotifPopup({ titulo: `Aviso ${TAG}`, mensagem: 'Leia <img src=x onerror=alert(1)' });

        const div = document.createElement('div');
        div.innerHTML = mensagem;
        semElementoDoDado(div);
        expect(div.textContent).toContain(`Aviso ${TAG}`);
    });
});

describe('o padrão sem escape não voltou', () => {
    it.each([
        ['js/app.js', /<span class="nome">\$\{aluno\.nome\}<\/span>/],
        ['js/app.js', /<h4>\$\{aluno\.nome\}<\/h4>/],
        ['js/app.js', /<small class="observacoes">\$\{aluno\.observacoes/],
        ['js/app.js', /<td class="col-condicao">\$\{aluno\./],
        ['js/app.js', /<td class="col-matricula">\$\{aluno\./],
        ['js/app.js', /<h4>\$\{aluno\.nome\.split/],
        ['js/app.js', />\$\{obsVal\}<\/textarea>/],
        ['js/app.js', /<td>\$\{nota\.(tipo|descricao|peso)/],
        ['js/app.js', /ui\.success\(`Aluno "\$\{alunoNome\}"/],
        ['js/secretaria-codigo-aluno.js', /'Código de ' \+ a\.nome/],
        ['js/frequencia-professores.js', /<span style="font-size: 0\.9rem;">\$\{materia\}<\/span>/],
        ['js/chat-direto-manager.js', /">\$\{emoji\} \$\{counts\[emoji\]\}/],
    ])('%s: %s', (rel, padrao) => {
        expect(fonte(rel)).not.toMatch(padrao);
    });

    it('os helpers de texto escapam < > e aspas sem recodificar o &', () => {
        for (const [rel, nome] of [
            ['js/app.js', 'escAttr'],
            ['js/secretaria-codigo-aluno.js', 'textoHtml'],
            ['js/realtime.js', 'textoHtml'],
        ]) {
            // eslint-disable-next-line no-new-func
            const f = new Function(`${textoDaFuncao(rel, nome)}\nreturn ${nome};`)();
            const div = document.createElement('div');
            div.innerHTML = `<span>${f(`${TAG}Pedro &amp; Maria`)}</span>`;
            semElementoDoDado(div);
            expect(div.textContent).toBe(`${TAG}Pedro & Maria`);
        }
    });
});
