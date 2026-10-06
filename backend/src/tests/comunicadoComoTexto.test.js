/**
 * @jest-environment jsdom
 */

/**
 * comunicadoComoTexto.test.js — Issue #648
 *
 * O conteúdo do comunicado é texto: o servidor tira as tags na gravação. Três
 * telas o tratavam como HTML — o mural (`dangerouslySetInnerHTML`), o sino
 * (`corpoHtml`) e o detalhe da direção — e o `stripHtml` usava `innerHTML`
 * numa div solta, que no navegador carrega a imagem e dispara o `onerror`
 * mesmo fora da página.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const TAG = '<img src=x onerror="window.__xss=1">';
// Como o filtro do servidor grava `<`: o texto já vem codificado.
const TAG_CODIFICADA = '&lt;img src=x onerror="window.__xss=1"&gt;';

/** Texto de `function nome(...) { ... }` dentro do arquivo. */
function textoDaFuncao(rel, nome) {
    const src = fonte(rel);
    const inicio = src.indexOf(`function ${nome}(`);
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
    expect(window.__xss).toBeUndefined();
}

afterEach(() => {
    delete window.__xss;
    document.body.innerHTML = '';
});

describe('sino de notificações (js/changelog.js)', () => {
    function renderizar(notificacoes) {
        document.body.innerHTML = '<div id="notif-list"></div>';
        const nomes = [
            'formatDate',
            'isLongText',
            'stripHtml',
            'escapeHtml',
            'capitalize',
            'renderNotificacoes',
        ];
        const corpo = nomes.map((n) => textoDaFuncao('js/changelog.js', n)).join('\n');
        // eslint-disable-next-line no-new-func
        const render = new Function(
            '_cachedNotifs',
            'iconMap',
            'bindNotifItemEvents',
            `${corpo}\nreturn renderNotificacoes;`
        )(notificacoes, { default: { icon: 'bi-bell', bg: '', color: '' } }, () => {});
        render();
        return document.getElementById('notif-list');
    }

    it('corpoHtml com tag crua (comunicado da IA, antes da #647): a tag sai, o texto fica', () => {
        const lista = renderizar([
            {
                _id: 'n1',
                tipo: 'aviso',
                titulo: 'Aviso',
                mensagem: 'resumo',
                corpoHtml: `Leia ${TAG}agora`,
            },
        ]);
        semElementoDoDado(lista);
        expect(lista.querySelector('.notif-desc').textContent).toBe('Leia agora');
    });

    it('corpoHtml com a tag codificada pelo filtro do servidor aparece como texto', () => {
        const lista = renderizar([
            {
                _id: 'n1',
                tipo: 'aviso',
                titulo: 'Aviso',
                mensagem: 'resumo',
                corpoHtml: TAG_CODIFICADA,
            },
        ]);
        semElementoDoDado(lista);
        expect(lista.querySelector('.notif-desc').textContent).toBe(TAG);
    });

    it('mensagem sem corpoHtml continua com a quebra de linha', () => {
        const lista = renderizar([
            { _id: 'n2', tipo: 'aviso', titulo: 'Aviso', mensagem: 'linha 1\nlinha 2' },
        ]);
        const desc = lista.querySelector('.notif-desc');
        expect(desc.querySelectorAll('br')).toHaveLength(1);
        expect(desc.textContent).toBe('linha 1linha 2');
    });
});

describe('detalhe do comunicado na direção (direcao/direcao-notificacoes.js)', () => {
    it('conteúdo, categoria, prioridade e público aparecem como texto', () => {
        document.body.innerHTML = `
            <h3 id="modalTitle"></h3><div id="confirmText"></div>
            <button id="btnConfirmarEnvio"></button>`;
        const src = fonte('direcao/direcao-notificacoes.js');
        const inicio = src.indexOf('window.verDetalhe = function');
        const fim = src.indexOf('\n};', inicio) + 3;
        const corpo = [
            textoDaFuncao('direcao/direcao-notificacoes.js', 'escapeHtml'),
            textoDaFuncao('direcao/direcao-notificacoes.js', 'textoDoHtml'),
            src.slice(inicio, fim),
        ].join('\n');
        // eslint-disable-next-line no-new-func
        new Function('comunicados', 'abrirModal', corpo)(
            [
                {
                    _id: 'c1',
                    titulo: 'Aviso',
                    categoria: TAG,
                    prioridade: TAG,
                    destinatarios: [`turma:${TAG}`],
                    dataCriacao: '2026-10-01T10:00:00Z',
                    conteudo: `Leia ${TAG}\nsegunda linha`,
                },
            ],
            () => {}
        );

        window.verDetalhe('c1');

        const texto = document.getElementById('confirmText');
        semElementoDoDado(texto);
        // A tag crua do conteúdo sai; nos campos de texto ela aparece como texto.
        expect(texto.textContent).toContain('Leia segunda linha');
        expect(texto.textContent).toContain(`Categoria: ${TAG}`);
        expect(texto.querySelectorAll('br').length).toBeGreaterThan(4);
    });
});

describe('mural (js/announcement-feed-react.js)', () => {
    const src = fonte('js/announcement-feed-react.js');

    it('o conteúdo não vai mais como HTML', () => {
        expect(src).not.toMatch(/dangerouslySetInnerHTML:\s*\{\s*__html:\s*comunicado\.conteudo/);
    });

    it('stripHtml usa documento inerte e devolve só o texto', () => {
        const trecho = src.match(/const stripHtml = \(html\) =>[\s\S]*?\|\| '';/);
        expect(trecho).not.toBeNull();
        expect(trecho[0]).toContain('DOMParser');
        // eslint-disable-next-line no-new-func
        const stripHtml = new Function(`${trecho[0]}\nreturn stripHtml;`)();
        expect(stripHtml(`<p>Oi ${TAG}</p>`)).toBe('Oi ');
        expect(stripHtml(TAG_CODIFICADA)).toBe('<img src=x onerror="window.__xss=1">');
        expect(document.querySelector('img')).toBeNull();
    });
});
