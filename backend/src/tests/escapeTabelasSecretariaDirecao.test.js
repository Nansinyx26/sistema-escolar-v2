/**
 * @jest-environment jsdom
 */

/**
 * escapeTabelasSecretariaDirecao.test.js — Issue #634
 *
 * Mesma classe do #631 (admin), nas telas da secretaria e da direção: log de
 * auditoria, justificativa, histórico de documentos, comunicados e turmas
 * entravam no innerHTML sem escape. O motivo da justificativa e os detalhes do
 * log são texto livre; o nome do login com Google não passa pelo filtro do
 * servidor.
 *
 * Os testes rodam as funções de render reais das páginas, com o `fetch`
 * simulado, e conferem que nenhum elemento nasce do dado.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const TAG = '<img src=x onerror="window.__xss=1">';
const NOME = `${TAG}Ana &amp; Bia`;
// Como aparece na tela: a tag como texto e o `&` do servidor uma vez só.
const NOME_NA_TELA = `${TAG}Ana & Bia`;

/** Texto de `function nome(...) { ... }` (ou `async function`) do arquivo. */
function textoDaFuncao(rel, nome) {
    const src = fonte(rel);
    const inicio = src.indexOf(`function ${nome}(`);
    if (inicio < 0) throw new Error(`${rel} não declara ${nome}`);
    const comeco = src.slice(Math.max(0, inicio - 6), inicio) === 'async ' ? inicio - 6 : inicio;
    let profundidade = 0;
    let fim = src.indexOf('{', inicio);
    for (; fim < src.length; fim++) {
        if (src[fim] === '{') profundidade++;
        if (src[fim] === '}' && --profundidade === 0) break;
    }
    return src.slice(comeco, fim + 1);
}

/** Monta as funções nomeadas num escopo isolado, com `deps` como variáveis livres. */
function montar(rel, nomes, deps = {}) {
    const corpo = nomes.map((n) => textoDaFuncao(rel, n)).join('\n');
    // eslint-disable-next-line no-new-func
    const fabrica = new Function(
        ...Object.keys(deps),
        `${corpo}\nreturn ${nomes[nomes.length - 1]};`
    );
    return fabrica(...Object.values(deps));
}

/** `fetch` que devolve sempre o mesmo JSON. */
const fetchCom = (json) => async () => ({ ok: true, json: async () => json });

/** Nenhum elemento nem atributo de evento saiu do dado. */
function semInjecao(container) {
    expect(container.querySelector('img, svg, script, iframe')).toBeNull();
    for (const el of container.querySelectorAll('*')) {
        for (const attr of el.getAttributeNames()) {
            expect(attr.startsWith('on')).toBe(false);
        }
    }
    expect(window.__xss).toBeUndefined();
}

afterEach(() => {
    delete window.__xss;
    delete window.logsExibidos;
    delete window.Swal;
    document.body.innerHTML = '';
});

describe('textoHtml das páginas da secretaria e da direção', () => {
    it.each([
        'direcao/auditoria.html',
        'html/secretaria/justificativas.html',
        'html/secretaria/documentos.html',
        'html/secretaria/comunicados.html',
        'html/secretaria/matriculas.html',
    ])('%s: tag vira texto e o & do servidor aparece uma vez só', (rel) => {
        const textoHtml = montar(rel, ['textoHtml']);
        const div = document.createElement('div');
        div.innerHTML = `<span>${textoHtml(NOME)}</span>`;
        semInjecao(div);
        expect(div.textContent).toBe(NOME_NA_TELA);
    });
});

describe('direcao/auditoria.html', () => {
    it('a linha do log não cria elemento', () => {
        document.body.innerHTML = '<table id="auditTable"><tbody></tbody></table>';
        const renderLogs = montar('direcao/auditoria.html', ['textoHtml', 'renderLogs']);

        renderLogs([
            {
                data: '2026-10-01T10:00:00Z',
                usuarioNome: NOME,
                usuarioEmail: `a"${TAG}@x.test`,
                perfil: TAG,
                acao: `UPDATE ${TAG}`,
                recurso: TAG,
                ip: TAG,
            },
        ]);

        const tbody = document.querySelector('#auditTable tbody');
        semInjecao(tbody);
        expect(tbody.textContent).toContain(NOME_NA_TELA);
        // O índice da linha continua lá para o botão de detalhes.
        expect(tbody.querySelector('[data-acao="verDetalhes"]').dataset.indice).toBe('0');
    });

    it('os detalhes vão para o modal como texto', () => {
        let opcoes;
        window.Swal = { fire: (o) => (opcoes = o) };
        const showDetails = montar('direcao/auditoria.html', ['showDetails']);

        showDetails({ motivo: TAG });

        expect(opcoes.html).toBeInstanceOf(HTMLElement);
        expect(opcoes.html.children).toHaveLength(0);
        expect(opcoes.html.textContent).toContain(TAG.replace(/"/g, '\\"'));
        semInjecao(opcoes.html);
    });
});

describe('html/secretaria/justificativas.html', () => {
    it('aluno, motivo, categoria, status e quem analisou não criam elemento', async () => {
        document.body.innerHTML = '<table><tbody id="justBody"></tbody></table>';
        const comuns = {
            motivo: `Consulta ${TAG}`,
            categoria: TAG,
            dataInicio: '2026-10-01',
            dataFim: '2026-10-02',
        };
        const carregar = montar(
            'html/secretaria/justificativas.html',
            ['textoHtml', 'escAttrAcao', 'carregarJustificativas'],
            {
                API: () => '/api',
                currentFilter: '',
                fetch: fetchCom({
                    success: true,
                    data: [
                        { _id: 'j1', alunoNome: NOME, status: 'pendente', ...comuns },
                        {
                            _id: 'j2',
                            alunoNome: NOME,
                            status: TAG,
                            analisadoPorNome: TAG,
                            ...comuns,
                        },
                    ],
                }),
            }
        );

        await carregar();

        const body = document.getElementById('justBody');
        semInjecao(body);
        expect(body.querySelectorAll('tr')).toHaveLength(2);
        expect(body.textContent).toContain(NOME_NA_TELA);
        expect(body.textContent).toContain(`Consulta ${TAG}`);
    });
});

describe('html/secretaria/documentos.html', () => {
    it('o histórico de documentos não cria elemento', async () => {
        document.body.innerHTML =
            '<input id="histAlunoId" value="a1"><table><tbody id="histBody"></tbody></table>';
        const carregar = montar(
            'html/secretaria/documentos.html',
            ['textoHtml', 'carregarHistorico'],
            {
                API: () => '/api',
                toast: () => {},
                fetch: fetchCom({
                    success: true,
                    data: [
                        {
                            titulo: `Declaração - ${NOME}`,
                            tipo: `declaracao_${TAG}`,
                            numeroDocumento: TAG,
                            createdAt: '2026-10-01',
                            emitidoPorNome: TAG,
                        },
                    ],
                }),
            }
        );

        await carregar();

        const body = document.getElementById('histBody');
        semInjecao(body);
        expect(body.textContent).toContain(`Declaração - ${NOME_NA_TELA}`);
    });
});

describe('html/secretaria/comunicados.html', () => {
    it('título, autor, categoria e prévia não criam elemento', async () => {
        document.body.innerHTML = '<div id="comList"></div>';
        const carregar = montar(
            'html/secretaria/comunicados.html',
            ['textoHtml', 'resumoDoConteudo', 'carregarComunicados'],
            {
                API: () => '/api',
                fetch: fetchCom({
                    success: true,
                    data: [
                        {
                            titulo: NOME,
                            autorNome: TAG,
                            categoria: TAG,
                            dataCriacao: '2026-10-01',
                            // Tag sem o `>` final: passava pelo filtro de regex.
                            conteudo: 'Aviso <img src=x onerror="window.__xss=1"',
                        },
                    ],
                }),
            }
        );

        await carregar();

        const lista = document.getElementById('comList');
        semInjecao(lista);
        expect(lista.querySelector('.sec-com-title').textContent).toBe(NOME_NA_TELA);
        expect(lista.querySelector('.sec-com-body').textContent).toBe(
            'Aviso <img src=x onerror="window.__xss=1"'
        );
    });

    it('a prévia corta em 200 caracteres do texto, sem as tags', () => {
        const resumo = montar('html/secretaria/comunicados.html', ['resumoDoConteudo']);
        expect(resumo('<p>Oi</p>')).toBe('Oi');
        expect(resumo(`<b>${'a'.repeat(250)}</b>`)).toBe(`${'a'.repeat(200)}...`);
        expect(resumo(undefined)).toBe('');
    });
});

describe('html/secretaria/matriculas.html', () => {
    it('a turma no select e na tabela não cria elemento', async () => {
        document.body.innerHTML =
            '<select id="matTurmaId"></select><table><tbody id="turmasBody"></tbody></table>';
        const carregar = montar(
            'html/secretaria/matriculas.html',
            ['textoHtml', 'carregarTurmas'],
            {
                API: () => '/api',
                fetch: fetchCom({
                    success: true,
                    data: [
                        {
                            _id: `t1" data-x="1`,
                            nome: NOME,
                            periodo: TAG,
                            capacidade: TAG,
                            totalAlunos: TAG,
                            ativo: true,
                        },
                    ],
                }),
            }
        );

        await carregar();

        const select = document.getElementById('matTurmaId');
        const tabela = document.getElementById('turmasBody');
        semInjecao(select);
        semInjecao(tabela);
        const opcao = select.querySelector('option');
        expect(opcao.getAttributeNames()).toEqual(['value']);
        expect(opcao.value).toBe('t1" data-x="1');
        expect(opcao.textContent).toBe(NOME_NA_TELA);
    });
});

describe('js/gerenciar-salas.js', () => {
    it('o nome do professor no card não cria elemento', () => {
        document.body.innerHTML = '<div id="salasGrid"></div>';
        // biome-ignore lint/security/noGlobalEval: avalia o script como a página avalia (escopo global), para chamar a função de render real.
        window.eval(
            `${fonte('js/gerenciar-salas.js')}
            window.__salas = { definir: (l) => { todosProfessores = l; }, renderizarSalas };`
        );
        window.__salas.definir([{ _id: 'p1', nome: NOME, salaPrincipal: '1ºA' }]);
        window.__salas.renderizarSalas();

        const grid = document.getElementById('salasGrid');
        semInjecao(grid);
        expect(grid.querySelector('.professor-info strong').textContent).toBe(NOME_NA_TELA);
        delete window.__salas;
    });
});
