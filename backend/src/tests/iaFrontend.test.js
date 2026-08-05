/**
 * @jest-environment jsdom
 */

/**
 * iaFrontend.test.js — módulos de interface do copiloto (`js/ia/`).
 *
 * Estes arquivos rodam no BROWSER, então a suíte precisa de DOM: o ambiente
 * desta suíte é jsdom (ver o docblock acima), diferente do `node` que o resto
 * do backend usa.
 *
 * O foco é a barreira de segurança que vive no cliente — o renderizador de
 * Markdown, que recebe texto não confiável vindo do modelo — e o
 * comportamento do stream, onde um erro silencioso apagaria a resposta que a
 * pessoa já leu.
 */

const { renderizarMarkdown } = require('../../../js/ia/MarkdownRenderer.js');
const { StreamRenderer } = require('../../../js/ia/StreamRenderer.js');

// No browser o DOMPurify vem de js/libs/purify.min.js. Aqui usamos o MESMO
// pacote (dependência de teste), e não um dublê: a segunda barreira só vale
// como garantia se for a real que está sendo exercitada.
beforeAll(() => {
    // eslint-disable-next-line global-require
    const createDOMPurify = require('dompurify');
    window.DOMPurify = createDOMPurify(window);
    expect(typeof window.DOMPurify.sanitize).toBe('function');
});

beforeEach(() => {
    document.body.innerHTML = '';
});

// ─────────────────────────────────────────────────────────────────────────────

describe('MarkdownRenderer — conversão', () => {
    it('converte os blocos que o assistente realmente produz', () => {
        expect(renderizarMarkdown('# Título')).toContain('<h1>Título</h1>');
        expect(renderizarMarkdown('- um\n- dois')).toContain('<li>um</li>');
        expect(renderizarMarkdown('1. a\n2. b')).toMatch(/<ol>.*<li>a<\/li>/s);
        expect(renderizarMarkdown('**forte**')).toContain('<strong>forte</strong>');
        expect(renderizarMarkdown('> citação')).toContain('<blockquote>');
        expect(renderizarMarkdown('---')).toContain('<hr>');
    });

    it('monta tabela com rolagem própria', () => {
        const html = renderizarMarkdown('| Turma | Alunos |\n|---|---|\n| 6A | 28 |');

        expect(html).toContain('<table>');
        expect(html).toContain('<th>Turma</th>');
        expect(html).toContain('<td>28</td>');
        // O wrapper é o que impede a tabela larga de empurrar a página no celular.
        expect(html).toContain('ia-tabela-wrap');
    });

    it('preserva o conteúdo de blocos de código sem interpretá-lo', () => {
        const html = renderizarMarkdown('```js\nconst a = 1 < 2 && b;\n```');

        expect(html).toContain('<pre');
        expect(html).toContain('linguagem-js');
        // O "<" do código vira entidade, não abre tag.
        expect(html).toContain('&lt;');
        expect(html).not.toContain('const a = 1 < 2');
    });

    it('não aplica formatação dentro de código inline', () => {
        const html = renderizarMarkdown('use `**isso**` literalmente');

        expect(html).toContain('<code>**isso**</code>');
        expect(html).not.toContain('<code><strong>');
    });

    it('link externo abre em nova aba com rel de segurança', () => {
        const html = renderizarMarkdown('[docs](https://exemplo.org)');

        expect(html).toContain('href="https://exemplo.org"');
        expect(html).toContain('rel="noopener noreferrer"');
    });
});

describe('MarkdownRenderer — barreira de XSS', () => {
    const ataques = [
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        '<iframe src="evil"></iframe>',
        '<svg/onload=alert(1)>',
        '<a href="#" onclick="steal()">x</a>',
        '**<b>injetado</b>**',
        '| <script>x</script> | b |\n|---|---|\n| 1 | 2 |',
        '```\n</code></pre><script>alert(1)</script>\n```',
        '> <img src=x onerror=alert(1)>',
        '# <script>t</script>',
        '- <script>l</script>'
    ];

    it.each(ataques)('neutraliza: %s', (entrada) => {
        const html = renderizarMarkdown(entrada);

        // O teste definitivo é o DOM: montamos o HTML e conferimos que nenhuma
        // tag perigosa existe de fato e que nenhum handler inline sobreviveu.
        const div = document.createElement('div');
        div.innerHTML = html;

        expect(div.querySelector('script, iframe, object, embed, svg, img')).toBeNull();

        for (const el of div.querySelectorAll('*')) {
            for (const attr of el.attributes) {
                expect(attr.name.toLowerCase()).not.toMatch(/^on/);
            }
        }
    });

    it('recusa href com esquema perigoso', () => {
        for (const url of ['javascript:alert(1)', '  JaVaScRiPt:alert(1)', 'data:text/html,<script>x</script>']) {
            const div = document.createElement('div');
            div.innerHTML = renderizarMarkdown(`[clique](${url})`);

            const link = div.querySelector('a');
            // Ou o link não foi criado, ou não aponta para o esquema perigoso.
            if (link) {
                expect(link.getAttribute('href')).not.toMatch(/^\s*(javascript|data|vbscript):/i);
            }
        }
    });

    /**
     * Degradação quando a segunda barreira não está disponível.
     *
     * Os três casos importam por motivos diferentes. `undefined` é o script que
     * nunca carregou. `null` e o objeto sem `sanitize` são carregamento PARCIAL
     * — e eram justamente os que escapavam da guarda antiga, escrita com
     * `typeof === 'undefined'`: `typeof null` é 'object', então a guarda passava
     * e o renderizador quebrava na chamada seguinte, no exato momento em que a
     * proteção não estava lá.
     */
    it.each([
        ['ausente', undefined],
        ['nulo', null],
        ['sem a função sanitize', {}]
    ])('degrada para texto puro com DOMPurify %s', (_rotulo, valor) => {
        const original = window.DOMPurify;
        window.DOMPurify = valor;
        const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            // Não pode lançar: uma falha aqui derrubaria a resposta inteira.
            const html = renderizarMarkdown('# Título <script>alert(1)</script>');

            // Sem a segunda barreira, nada de HTML construído: só texto escapado.
            expect(html).not.toContain('<h1>');
            expect(html).toContain('&lt;script&gt;');
            expect(erro).toHaveBeenCalled();
        } finally {
            window.DOMPurify = original;
            erro.mockRestore();
        }
    });
});

describe('StreamRenderer', () => {
    function montar() {
        const container = document.createElement('div');
        document.body.appendChild(container);
        return { container, renderer: new StreamRenderer(container) };
    }

    it('a bolha do usuário nunca interpreta HTML', () => {
        const { container, renderer } = montar();

        renderer.adicionarMensagemUsuario('<script>alert(1)</script> e <b>negrito</b>');

        const bolha = container.querySelector('.ia-msg-usuario .ia-bolha');
        expect(bolha.querySelector('script')).toBeNull();
        expect(bolha.querySelector('b')).toBeNull();
        // O texto aparece literalmente, como a pessoa digitou.
        expect(bolha.textContent).toContain('<script>alert(1)</script>');
    });

    it('acumula os deltas e finaliza com o Markdown renderizado', () => {
        const { container, renderer } = montar();

        renderer.iniciarResposta();
        expect(container.querySelector('.ia-pensando')).not.toBeNull();

        renderer.adicionarDelta('**Turma** ');
        renderer.adicionarDelta('6A');

        const texto = renderer.finalizarResposta({});

        expect(texto).toBe('**Turma** 6A');
        expect(container.querySelector('.ia-bolha strong').textContent).toBe('Turma');
        // O indicador de "pensando" e o cursor somem ao fechar.
        expect(container.querySelector('.ia-pensando')).toBeNull();
        expect(container.querySelector('.ia-cursor')).toBeNull();
    });

    it('marca aria-busy durante a geração e libera ao fim', () => {
        const { container, renderer } = montar();

        renderer.iniciarResposta();
        expect(container.querySelector('.ia-msg-assistente').getAttribute('aria-busy')).toBe('true');

        renderer.adicionarDelta('pronto');
        renderer.finalizarResposta({});

        // Só agora o leitor de tela anuncia — com o texto completo.
        expect(container.querySelector('.ia-msg-assistente').hasAttribute('aria-busy')).toBe(false);
    });

    it('um erro no meio NÃO descarta o texto já recebido', () => {
        const { container, renderer } = montar();

        renderer.iniciarResposta();
        renderer.adicionarDelta('A resposta ia bem até aqui');
        renderer.mostrarAviso('Conexão perdida.');

        const bolha = container.querySelector('.ia-msg-assistente .ia-bolha');
        expect(bolha.textContent).toContain('A resposta ia bem até aqui');
        expect(bolha.querySelector('.ia-aviso-erro').textContent).toBe('Conexão perdida.');
    });

    it('resposta vazia é sinalizada em vez de deixar bolha em branco', () => {
        const { container, renderer } = montar();

        renderer.iniciarResposta();
        renderer.finalizarResposta({});

        expect(container.querySelector('.ia-sem-resposta')).not.toBeNull();
    });

    it('mostra as consultas feitas ao sistema com rótulo legível', () => {
        const { container, renderer } = montar();

        renderer.iniciarResposta();
        renderer.mostrarFerramenta('contarAlunos');

        const chip = container.querySelector('.ia-ferramenta');
        expect(chip.textContent).toBe('Contando alunos...');
        // Nome técnico desconhecido ainda produz algo legível.
        renderer.mostrarFerramenta('ferramentaNova');
        expect(container.querySelectorAll('.ia-ferramenta')[1].textContent)
            .toBe('Consultando o sistema...');
    });

    it('os botões de ação chamam os callbacks recebidos', () => {
        const { container, renderer } = montar();
        const aoCopiar = jest.fn();
        const aoRegenerar = jest.fn();

        renderer.iniciarResposta();
        renderer.adicionarDelta('texto final');
        renderer.finalizarResposta({ aoCopiar, aoRegenerar });

        const botoes = container.querySelectorAll('.ia-acao');
        expect(botoes).toHaveLength(2); // sem voz disponível no ambiente de teste

        botoes[0].click();
        expect(aoCopiar).toHaveBeenCalledWith('texto final', botoes[0]);

        botoes[1].click();
        expect(aoRegenerar).toHaveBeenCalled();
    });

    it('repinta uma resposta vinda do histórico sem passar pelo streaming', () => {
        const { container, renderer } = montar();

        renderer.adicionarRespostaPronta('## Do histórico', {
            ferramentas: ['listarTurmas'],
            aoCopiar: () => {}
        });

        expect(container.querySelector('.ia-bolha h2').textContent).toBe('Do histórico');
        // A consulta aparece como já concluída, sem o ponto piscando.
        expect(container.querySelector('.ia-ferramenta-feita')).not.toBeNull();
        expect(container.querySelector('.ia-pensando')).toBeNull();
    });
});
