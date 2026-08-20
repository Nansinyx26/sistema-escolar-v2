/**
 * menuConversas.test.js — a entrada "Conversas" e o selo de não lidas (#72).
 *
 * POR QUE ESTE TESTE EXISTE
 * -------------------------
 * O selo depende de QUATRO peças que moram em arquivos diferentes e não se
 * importam entre si:
 *
 *   1. o link para a página, na barra lateral;
 *   2. o atributo `data-conversas-badge` nesse link;
 *   3. a `<script>` de js/menu-conversas.js na página;
 *   4. a classe `.conversas-badge` em css/sidebar.css.
 *
 * Faltando qualquer uma, nada acontece — e nada acontece EM SILÊNCIO. Foi
 * exatamente o que ocorreu enquanto isto era construído: o script foi escrito
 * e commitado, mas nenhuma página o carregava e nenhum link tinha o atributo.
 * O código estava lá, correto, e o selo não aparecia em lugar nenhum.
 *
 * O teste percorre as quatro telas e cobra as quatro peças em cada uma.
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');

/**
 * As telas onde a entrada precisa existir, e por quê.
 *
 * A lista é derivada de `getRedirectPath` (UserController): é para onde cada
 * perfil vai depois do login. Uma tela de fora desta lista não é a casa de
 * ninguém, e uma que falte aqui deixa um perfil sem caminho para a conversa.
 */
const TELAS = [
    ['html/dashboard.html', 'professor, diretor e admin'],
    ['html/secretaria/painel.html', 'secretaria'],
    ['html/direcao/index.html', 'direção'],
    ['html/direcao/gerenciar-secretaria.html', 'direção'],
];

const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

describe.each(TELAS)('%s (%s)', (arquivo) => {
    let html;
    beforeAll(() => {
        html = ler(arquivo);
    });

    it('tem link para a página de conversas', () => {
        expect(html).toContain('href="/html/conversas.html"');
    });

    it('marca o link com o atributo que o selo procura', () => {
        // Sem isto o script roda, não encontra alvo e sai calado.
        expect(html).toContain('data-conversas-badge');
    });

    it('carrega js/menu-conversas.js', () => {
        // Sem isto o atributo fica no HTML sem ninguém para lê-lo.
        expect(html).toMatch(/<script[^>]+menu-conversas\.js/);
    });
});

describe('as peças combinam entre si', () => {
    it('o atributo do HTML é o mesmo que o script consulta', () => {
        const script = ler('js/menu-conversas.js');
        expect(script).toContain('data-conversas-badge');
    });

    it('a classe que o script cria existe no CSS compartilhado', () => {
        const script = ler('js/menu-conversas.js');
        const css = ler('css/sidebar.css');

        expect(script).toContain('conversas-badge');
        expect(css).toContain('.conversas-badge');
        // Zero não lidas precisa sumir de verdade, não virar um selo vazio.
        expect(css).toContain('.conversas-badge[hidden]');
    });

    it('todas as telas carregam o CSS onde o selo está definido', () => {
        for (const [arquivo] of TELAS) {
            expect(ler(arquivo)).toContain('sidebar.css');
        }
    });

    it('o script consome o contador próprio, não a lista de contatos', () => {
        // `/contatos` consulta quatro coleções para montar a lista. Pagar isso
        // em toda página de todo perfil, por um número, seria trocar uma
        // contagem indexada por uma varredura.
        //
        // A busca é pela CHAMADA, não pelo texto do arquivo: os comentários do
        // script citam `/chat-direto/contatos` para explicar por que NÃO o
        // usam, e um `not.toContain` cru reprovaria por causa da explicação.
        const chamadas = [
            ...ler('js/menu-conversas.js').matchAll(/\$\{API\(\)\}(\/[a-z-/]+)/g),
        ].map((m) => m[1]);

        expect(chamadas).toContain('/chat-direto/nao-lidas');
        expect(chamadas).not.toContain('/chat-direto/contatos');
    });

    it('o link do menu aponta para um arquivo que existe', () => {
        // Um href com erro de digitação só aparece como 404 para quem clica.
        for (const [arquivo] of TELAS) {
            const alvo = /href="(\/html\/conversas\.html)"/.exec(ler(arquivo));
            expect(alvo).not.toBeNull();
            expect(fs.existsSync(path.join(RAIZ, alvo[1].replace(/^\//, '')))).toBe(true);
        }
    });
});

describe('a entrada não é escondida por perfil', () => {
    it('o link do dashboard não usa as classes de restrição da tela', () => {
        const html = ler('html/dashboard.html');
        const linha = html.split('\n').find((l) => l.includes('href="/html/conversas.html"'));

        expect(linha).toBeDefined();
        // Professor, diretor e admin dividem esta barra e os três conversam.
        // `director-only` ou `secretaria-only` aqui esconderia a tela de quem
        // tem direito a ela — quem cada um alcança é decidido no servidor.
        expect(linha).not.toMatch(/director-only|secretaria-only/);
    });
});
