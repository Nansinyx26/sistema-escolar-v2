/**
 * @jest-environment jsdom
 */

/**
 * modalEdicaoAluno.test.js — Issue #642
 *
 * O lápis de "Todos os Alunos" (detalhes/alunos.html) abria o modal de edição
 * sem que ele aparecesse: `.modal-overlay`, em css/components.css, só fica
 * visível com `.show`, e `abrirModalEdicao` só tirava `.hidden`.
 *
 * Os testes rodam as funções reais de abrir e fechar sobre o modal real da
 * página, com as folhas de estilo que ela carrega, e leem o estilo computado.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

/** Texto de `inicio ... }` com as chaves balanceadas a partir de `inicio`. */
function blocoDesde(src, inicio) {
    const pos = src.indexOf(inicio);
    if (pos < 0) throw new Error(`não achei ${inicio}`);
    let profundidade = 0;
    let fim = src.indexOf('{', pos);
    for (; fim < src.length; fim++) {
        if (src[fim] === '{') profundidade++;
        if (src[fim] === '}' && --profundidade === 0) break;
    }
    return src.slice(pos, fim + 1);
}

/**
 * `abrirModalEdicao` e `fecharModal` reais. As dependências que o arquivo
 * declara em outro ponto entram como parâmetros, para o teste valer antes e
 * depois da #636 (que tira as abas e põe o link para Autorizações dos Pais).
 */
function funcoesDoModal() {
    const src = fonte('detalhes/alunos.js');
    const abrir = blocoDesde(src, 'function abrirModalEdicao(');
    const fechar = blocoDesde(src, 'window.fecharModal = function');
    // eslint-disable-next-line no-new-func
    return new Function(
        'alternarAbaFicha',
        'PERFIS_AUTORIZACOES',
        'perfilAtual',
        `${abrir}\n${fechar};\nreturn { abrirModalEdicao, fecharModal: window.fecharModal };`
    )(
        () => {},
        [],
        () => ''
    );
}

/** O modal como está em detalhes/alunos.html, com o CSS que a página usa nele. */
function montarPagina() {
    const html = fonte('detalhes/alunos.html');
    const inicio = html.indexOf('<div id="modalEditAluno"');
    const fim = html.indexOf('</form>', inicio);
    const estilo = document.createElement('style');
    estilo.textContent = ['css/components.css', 'detalhes/detalhes.css'].map(fonte).join('\n');
    document.head.appendChild(estilo);
    document.body.innerHTML = `${html.slice(inicio, fim)}</form></div></div>`;
    return document.getElementById('modalEditAluno');
}

const visivel = (el) => {
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
};

beforeEach(() => {
    window.apiFetch = () => Promise.resolve({ data: [] });
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    delete window.apiFetch;
    delete window.fecharModal;
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    jest.restoreAllMocks();
});

describe('modal de edição do aluno (detalhes/alunos)', () => {
    it('a página carrega o CSS que esconde `.modal-overlay` sem `.show`', () => {
        const html = fonte('detalhes/alunos.html');
        expect(html).toMatch(/href="[./]*\/css\/components\.css"/);
        expect(html).toMatch(/<div id="modalEditAluno" class="modal-overlay hidden">/);
    });

    it('começa fechado', () => {
        expect(visivel(montarPagina())).toBe(false);
    });

    it('o lápis abre o modal visível, com os dados do aluno', () => {
        const modal = montarPagina();
        const { abrirModalEdicao } = funcoesDoModal();

        abrirModalEdicao({ _id: 'a1', nome: 'Bruno Alves', turmaId: '' });

        expect(modal.classList.contains('show')).toBe(true);
        expect(visivel(modal)).toBe(true);
        expect(document.getElementById('editAlunoNome').value).toBe('Bruno Alves');
    });

    it('em tela baixa, o conteúdo rola por dentro em vez de sair da tela', () => {
        const modal = montarPagina();
        const conteudo = getComputedStyle(modal.querySelector('.modal-content'));
        expect(conteudo.overflowY).toBe('auto');
        expect(conteudo.maxHeight).toMatch(/^90d?vh$/);
    });

    it('fechar esconde, e abrir de novo mostra outra vez', () => {
        const modal = montarPagina();
        const { abrirModalEdicao, fecharModal } = funcoesDoModal();

        abrirModalEdicao({ _id: 'a1', nome: 'Bruno Alves', turmaId: '' });
        fecharModal();
        expect(modal.classList.contains('show')).toBe(false);
        expect(visivel(modal)).toBe(false);

        abrirModalEdicao({ _id: 'a2', nome: 'Carla Dias', turmaId: '' });
        expect(visivel(modal)).toBe(true);
        expect(document.getElementById('editAlunoNome').value).toBe('Carla Dias');
    });
});
