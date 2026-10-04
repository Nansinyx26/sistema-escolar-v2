/**
 * @jest-environment jsdom
 */

/**
 * escapeTabelasAdmin.test.js — Issue #631
 *
 * As tabelas de usuários e de pedidos LGPD do admin punham nome, e-mail,
 * protocolo e motivo direto no innerHTML. O filtro do servidor tira tags do
 * corpo das requisições, mas o nome do login com Google não passa por ele —
 * e são as telas de quem tem mais poder no sistema.
 *
 * Os testes montam as linhas com as funções de render reais das páginas.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const NOME_MALICIOSO = '<img src=x onerror="window.__xss=1">Ana';
const EMAIL_MALICIOSO = 'a"><svg onload="window.__xss=1">@x.test';
// Como o servidor grava: `&` já codificado.
const NOME_COM_E = 'Pedro &amp; Maria';

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

/** Monta as funções nomeadas num escopo isolado, com `params` livres. */
function montar(rel, nomes, params = []) {
    const corpo = nomes.map((n) => textoDaFuncao(rel, n)).join('\n');
    // eslint-disable-next-line no-new-func
    return new Function(...params, `${corpo}\nreturn ${nomes[nomes.length - 1]};`);
}

/** Nenhum elemento nem atributo de evento saiu do dado. */
function semInjecao(container) {
    expect(container.querySelector('img, svg, script')).toBeNull();
    for (const el of container.querySelectorAll('*')) {
        for (const attr of el.getAttributeNames()) {
            expect(attr.startsWith('on')).toBe(false);
        }
    }
    expect(window.__xss).toBeUndefined();
}

afterEach(() => {
    delete window.__xss;
    document.body.innerHTML = '';
});

describe('textoHtml das páginas do admin', () => {
    it.each(['html/admin/usuarios.html', 'html/admin/pedidos-lgpd.html'])(
        '%s: tag vira texto e o & do servidor aparece uma vez só',
        (rel) => {
            const textoHtml = montar(rel, ['textoHtml'])();
            const div = document.createElement('div');
            div.innerHTML = `<span>${textoHtml(NOME_MALICIOSO)}</span><b>${textoHtml(NOME_COM_E)}</b>`;
            semInjecao(div);
            expect(div.querySelector('span').textContent).toBe(NOME_MALICIOSO);
            expect(div.querySelector('b').textContent).toBe('Pedro & Maria');
        }
    );
});

describe('html/admin/usuarios.html — tabela de usuários', () => {
    it('nome, e-mail, perfil e origem maliciosos não criam elemento', () => {
        const tabela = document.createElement('table');
        const tbody = tabela.createTBody();
        document.body.appendChild(tabela);
        const renderTable = montar(
            'html/admin/usuarios.html',
            ['attrHtml', 'textoHtml', 'renderTable'],
            ['usersTable']
        )(tbody);

        renderTable([
            {
                id: 'u1',
                nome: NOME_MALICIOSO,
                email: EMAIL_MALICIOSO,
                perfil: '<b>diretor</b>',
                source: 'MongoDB',
            },
        ]);

        semInjecao(tbody);
        const celulas = tbody.querySelectorAll('td');
        expect(celulas[0].textContent.trim()).toBe(NOME_MALICIOSO);
        expect(celulas[1].textContent).toBe(EMAIL_MALICIOSO);
        expect(celulas[2].textContent).toBe('<b>diretor</b>');
        // As ações continuam recebendo o id intacto pelo dataset.
        expect(tbody.querySelector('[data-acao="excluirUsuario"]').dataset.email).toBe(EMAIL_MALICIOSO);
    });
});

describe('html/admin/pedidos-lgpd.html — pedidos do titular', () => {
    const PEDIDO = {
        id: 'p1',
        protocolo: 'LGPD-1<img src=x onerror="window.__xss=1">',
        usuarioNome: NOME_MALICIOSO,
        usuarioEmail: EMAIL_MALICIOSO,
        perfil: 'responsavel',
        tipo: 'exclusao',
        status: 'pendente',
        diasRestantes: 10,
        createdAt: '2026-10-01T10:00:00Z',
        motivo: 'Quero sair <script>window.__xss=1</script>',
        historico: [
            {
                status: 'em_analise',
                alteradoPor: '<i onmouseover="window.__xss=1">admin</i>',
                alteradoEm: '2026-10-02T10:00:00Z',
                observacao: '<img src=x onerror="window.__xss=1">',
            },
        ],
    };
    const FUNCOES = ['attrHtml', 'textoHtml', 'fmtDate', 'badgeStatus', 'tipoLabel'];

    it('a linha da tabela não cria elemento', () => {
        document.body.innerHTML = '<table><tbody id="tabelaPedidosBody"></tbody></table>';
        const renderTabela = montar('html/admin/pedidos-lgpd.html', [...FUNCOES, 'renderTabela'])();

        renderTabela([PEDIDO]);

        const tbody = document.getElementById('tabelaPedidosBody');
        semInjecao(tbody);
        expect(tbody.textContent).toContain(PEDIDO.protocolo);
        expect(tbody.textContent).toContain(NOME_MALICIOSO);
    });

    it('o detalhe do pedido (motivo e histórico) não cria elemento', () => {
        document.body.innerHTML = `
            <div id="modalDespacho"><div id="modalDetalhesCorpo"></div>
            <input id="despachoPedidoId"><select id="despachoNovoStatus"><option value="em_analise"></option></select>
            <input id="despachoObservacao"><textarea id="despachoResposta"></textarea>
            <div id="boxAnonimizar"></div><input type="checkbox" id="checkAnonimizar"></div>`;
        const abrirModal = montar(
            'html/admin/pedidos-lgpd.html',
            [...FUNCOES, 'abrirModal'],
            ['listaAtual']
        )([PEDIDO]);

        abrirModal('p1');

        const corpo = document.getElementById('modalDetalhesCorpo');
        semInjecao(corpo);
        expect(corpo.textContent).toContain(PEDIDO.motivo);
        expect(corpo.textContent).toContain('<img src=x onerror="window.__xss=1">');
    });
});
