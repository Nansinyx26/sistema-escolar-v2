/**
 * @jest-environment jsdom
 */

/**
 * fichaAlunoAutorizacoes.test.js — Issue #636
 *
 * A edição do aluno (detalhes/alunos.*) carregava documentos e autorizações do
 * responsável num painel que não tinha marcação na página: o código buscava na
 * API e não mostrava nada. Esse código saiu. No lugar, a edição tem um link
 * para "Autorizações dos Pais", que já abre a ficha do aluno — e só aparece
 * para quem pode abrir aquela tela (ver `js/guarda-acesso.js`).
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

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

/** O modal de edição como está em detalhes/alunos.html. */
function montarModal() {
    const html = fonte('detalhes/alunos.html');
    const inicio = html.indexOf('<div id="modalEditAluno"');
    const fim = html.indexOf('</form>', inicio);
    document.body.innerHTML = `${html.slice(inicio, fim)}</form></div></div>`;
}

/** `abrirModalEdicao` real, com a lista de perfis declarada no arquivo. */
function abrirModalEdicao() {
    const src = fonte('detalhes/alunos.js');
    const perfis = src.match(/const PERFIS_AUTORIZACOES = (\[[^\]]*\]);/);
    if (!perfis) throw new Error('detalhes/alunos.js não declara PERFIS_AUTORIZACOES');
    const corpo = ['perfilAtual', 'abrirModalEdicao']
        .map((n) => textoDaFuncao('detalhes/alunos.js', n))
        .join('\n');
    // eslint-disable-next-line no-new-func
    return new Function(
        `const PERFIS_AUTORIZACOES = ${perfis[1]};\n${corpo}\nreturn abrirModalEdicao;`
    )();
}

const ALUNO = { _id: 'a1/?x=1', nome: 'Bruno Alves', turmaId: 't1' };

function abrirComo(perfil) {
    montarModal();
    if (perfil) sessionStorage.setItem('currentUser', JSON.stringify({ perfil }));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    abrirModalEdicao()(ALUNO);
    return {
        secao: document.getElementById('secaoAutorizacoesAluno'),
        link: document.getElementById('linkAutorizacoesAluno'),
    };
}

afterEach(() => {
    sessionStorage.clear();
    document.body.innerHTML = '';
    jest.restoreAllMocks();
});

describe('link da edição do aluno para Autorizações dos Pais', () => {
    it('aponta para a ficha do aluno, com o id codificado', () => {
        const { link } = abrirComo('secretaria');
        expect(link.getAttribute('href')).toBe('autorizacoes-pais.html?aluno=a1%2F%3Fx%3D1');
    });

    it.each(['admin', 'diretor', 'secretaria'])('aparece para %s', (perfil) => {
        expect(abrirComo(perfil).secao.hidden).toBe(false);
    });

    it.each([['professor'], ['responsavel'], [null]])(
        'fica escondido para %s (a tela de destino barraria)',
        (perfil) => {
            expect(abrirComo(perfil).secao.hidden).toBe(true);
        }
    );

    it('os perfis do link são os mesmos que a guarda libera para a tela', () => {
        const guarda = fonte('js/guarda-acesso.js');
        const regra = guarda.match(
            /['"]\/detalhes\/autorizacoes-pais\.html['"]\s*:\s*\{\s*perfis:\s*\[([^\]]*)\]/
        );
        expect(regra).not.toBeNull();
        const daGuarda = regra[1].match(/[a-z]+/g).sort();
        const doLink = fonte('detalhes/alunos.js')
            .match(/const PERFIS_AUTORIZACOES = \[([^\]]*)\]/)[1]
            .match(/[a-z]+/g)
            .sort();
        expect(doLink).toEqual(daGuarda);
    });
});

describe('o painel sem tela saiu de detalhes/alunos.*', () => {
    it('a página não tem mais a "Ficha Assinada" nem os botões de status', () => {
        const html = fonte('detalhes/alunos.html');
        expect(html).not.toMatch(/secaoDocumentosAluno|data-status-doc|Ficha Assinada/);
    });

    it.each([
        'carregarAutorizacoesEDocumentos',
        'carregarTodosDocumentosAssinados',
        'abrirVisualizacaoDoc',
        'atualizarStatusDoc',
        'setupRealtimeDocListeners',
        'alternarAbaFicha',
    ])('detalhes/alunos.js não declara %s', (nome) => {
        expect(fonte('detalhes/alunos.js')).not.toMatch(new RegExp(`\\b${nome}\\b`));
    });
});
