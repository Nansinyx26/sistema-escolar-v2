/**
 * @jest-environment jsdom
 */

/**
 * chatbotBiEscape.test.js — Issue #649
 *
 * O chatbot e o BI pedagógico punham no `innerHTML` texto vindo do banco (nome
 * de aluno, comunicado, matéria) ou do modelo de IA, só trocando `**x**` por
 * `<strong>`. O rótulo da opção de aluno voltava cru pelo `dataset`.
 *
 * Os testes rodam as funções reais, com o mínimo de dublê.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const TAG = '<img src=x onerror="window.__xss=1">';

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

describe('chatbot (js/chatbot-ia.js)', () => {
    function addMessage() {
        document.body.innerHTML = '<div id="corpo"></div>';
        const nomes = ['escAttr', 'attrHtml', 'formatBold', 'addMessage'];
        const corpo = nomes.map((n) => textoDaFuncao('js/chatbot-ia.js', n)).join('\n');
        // eslint-disable-next-line no-new-func
        return new Function(
            'messages',
            'body',
            'audioSettings',
            'getCurrentUser',
            'getUserPhoto',
            'getInitials',
            'playAudio',
            `${corpo}\nreturn addMessage;`
        )(
            [],
            document.getElementById('corpo'),
            { autoPlay: false },
            () => ({ nome: 'Ana' }),
            () => null,
            () => 'A',
            () => {}
        );
    }

    it('resposta com tag aparece como texto e o negrito continua', () => {
        addMessage()(`Notas de **${TAG}Ana**: 8,0`, true);
        const bolha = document.querySelector('.msg-text-bubble');
        semElementoDoDado(bolha);
        expect(bolha.querySelector('strong').textContent).toBe(`${TAG}Ana`);
    });

    it('rótulo da opção que volta pelo dataset aparece como texto', () => {
        const add = addMessage();
        add('Qual aluno?', true, [{ label: `${TAG} — Turma 5A`, value: 'a1' }]);
        const rotulo = document.querySelector('.chatbot-option-btn').dataset.rotulo;
        // O rótulo volta cru do `dataset` e vira a mensagem do usuário.
        add(rotulo, false);
        semElementoDoDado(document.getElementById('corpo'));
    });
});

describe('BI pedagógico (html/direcao/bi-pedagogico.js)', () => {
    const REL = 'html/direcao/bi-pedagogico.js';

    it('sumário da IA e matéria crítica aparecem como texto, com o negrito', () => {
        document.body.innerHTML = '<div id="insightsContainer"></div>';
        const corpo = ['textoBi', 'renderAIPedagogicalSummary']
            .map((n) => textoDaFuncao(REL, n))
            .join('\n');
        // eslint-disable-next-line no-new-func
        const render = new Function(`${corpo}\nreturn renderAIPedagogicalSummary;`)();

        try {
            render({
                sumario: `A turma de **${TAG}Ana** precisa de atenção.`,
                mediaEscola: 7,
                alunosRisco: 2,
                materiaCritica: TAG,
            });
        } catch {
            // O resto da função liga botões que este teste não monta.
        }

        const c = document.getElementById('insightsContainer');
        semElementoDoDado(c);
        expect(c.querySelector('.summary-text strong').textContent).toBe(`${TAG}Ana`);
        expect(c.textContent).toContain(TAG);
    });

    it('o título do detalhe do mapa de calor vai como texto (titleText)', () => {
        const src = fonte(REL);
        expect(src).toMatch(/titleText: `\$\{nomeMateria\} — Turma \$\{turma\}`/);
        expect(src).not.toMatch(/\btitle: `\$\{nomeMateria\}/);
    });
});
