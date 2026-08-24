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
 *
 * A direção tem página própria (Issue #83): dentro de `/html/direcao` ela
 * herda o gate da área (`admin`, `diretor`) em vez de usar a tela solta e
 * compartilhada com os outros perfis. `dashboard.html` e
 * `secretaria/painel.html` seguem na compartilhada.
 */
const TELAS = [
    ['html/dashboard.html', 'professor, diretor e admin', '/html/conversas.html'],
    ['html/secretaria/painel.html', 'secretaria', '/html/conversas.html'],
    ['html/direcao/index.html', 'direção', '/html/direcao/conversas.html'],
    ['html/direcao/gerenciar-secretaria.html', 'direção', '/html/direcao/conversas.html'],
];

const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

describe.each(TELAS)('%s (%s)', (arquivo, _perfil, hrefEsperado) => {
    let html;
    beforeAll(() => {
        html = ler(arquivo);
    });

    it('tem link para a página de conversas', () => {
        expect(html).toContain(`href="${hrefEsperado}"`);
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
        for (const [arquivo, , hrefEsperado] of TELAS) {
            const alvo = new RegExp(`href="(${hrefEsperado.replace(/\//g, '\\/')})"`).exec(
                ler(arquivo)
            );
            expect(alvo).not.toBeNull();
            expect(fs.existsSync(path.join(RAIZ, alvo[1].replace(/^\//, '')))).toBe(true);
        }
    });
});

describe('som de mensagem recebida', () => {
    /**
     * O som já existe em js/som-notificacao.js e respeita a preferência
     * `chatSomAtivo` — a mesma do botão de mudo de dentro da conversa. O que
     * este bloco cobra é o ENCAIXE: nas telas onde o chat-direto-manager não
     * está carregado, ninguém mais avisaria que chegou mensagem.
     */
    const SEM_MANAGER = ['html/secretaria/painel.html', 'html/direcao/gerenciar-secretaria.html'];

    it.each(SEM_MANAGER)('%s carrega o sintetizador de som', (arquivo) => {
        const html = ler(arquivo);
        // Confirma a premissa: se um dia esta tela passar a carregar o manager,
        // o teste abaixo perde o sentido e este expect avisa.
        expect(html).not.toMatch(/<script[^>]+chat-direto-manager\.js/);
        expect(html).toMatch(/<script[^>]+som-notificacao\.js/);
    });

    it.each(SEM_MANAGER)('%s carrega o som ANTES de quem o chama', (arquivo) => {
        const html = ler(arquivo);
        // `defer` roda na ordem do documento: invertido, o menu-conversas.js
        // chamaria window.SomNotificacao antes de ele existir.
        expect(html.indexOf('som-notificacao.js')).toBeLessThan(
            html.indexOf('<script defer src="../../js/menu-conversas.js')
        );
    });

    it('o script não toca som onde o manager já toca', () => {
        // Nas telas com o chat-direto-manager o som é dele; tocar aqui também
        // sairia duplicado a cada mensagem.
        const script = ler('js/menu-conversas.js');
        expect(script).toContain('window.chatManager');
        expect(script).toContain('SomNotificacao');
    });
});

describe('o selo zera nas outras abas de quem leu', () => {
    /**
     * `chat:lidas` significa "o OUTRO leu as suas mensagens" e é emitido só
     * para o outro lado — quem leu nunca o recebe. Escutá-lo aqui deixava o
     * selo aceso nas demais abas até a revalidação de 60s, com o produto
     * apontando mensagem que a pessoa já tinha lido.
     */
    it('o script escuta o evento das próprias abas, não o do outro lado', () => {
        const script = ler('js/menu-conversas.js');
        expect(script).toContain("'chat:conversa-lida'");
        expect(script).not.toContain("window.socket.on('chat:lidas'");
    });

    it('o backend emite esse evento para quem leu', () => {
        const controller = ler('backend/src/controllers/ChatDiretoController.js');
        expect(controller).toContain("emit('chat:conversa-lida'");
        // Para MIM, não para o outro: trocar o destinatário aqui é justamente
        // o defeito que este par de testes existe para travar.
        expect(controller).toMatch(/user:\$\{meuId\}`\)\.emit\('chat:conversa-lida'/);
    });

    it('não reusa chat:lidas, que o manager lê com outro sentido', () => {
        // O chat-direto-manager trata `chat:lidas` como "marque as MINHAS
        // bolhas como lidas". Reemiti-lo para quem leu marcaria as erradas.
        const manager = ler('js/chat-direto-manager.js');
        expect(manager).toContain("s.on('chat:lidas'");
        expect(manager).toContain('marcarLidasLocalmente');
    });
});

describe('o selo não pisca a cada navegação', () => {
    /**
     * Sem cache, o selo aparecia do nada uns instantes depois de a página
     * montar — empurrando o texto do item ao lado — a cada troca de tela.
     * O último total conhecido pinta primeiro e o fetch reconcilia.
     */
    const script = () => ler('js/menu-conversas.js');

    it('pinta o último total antes de consultar o servidor', () => {
        const corpo = script();
        expect(corpo).toContain('pintarDoCache');
        // A ordem é o que remove a piscada: buscar primeiro anularia o ganho.
        expect(corpo.indexOf('pintarDoCache();')).toBeLessThan(corpo.indexOf('setInterval(buscar'));
    });

    it('a chave do cache é presa ao dono da sessão', () => {
        // Sem o id no nome, sair de uma conta e entrar em outra no mesmo
        // navegador mostraria à segunda pessoa o número da primeira.
        expect(script()).toMatch(/conversasNaoLidas:\$\{meuId\}/);
    });

    it('descarta cache velho em vez de afirmar pendência vencida', () => {
        // Número velho na tela é pior do que nenhum: ele afirma uma pendência
        // que talvez já não exista.
        const corpo = script();
        expect(corpo).toContain('VALIDADE_DO_CACHE');
        expect(corpo).toMatch(/Date\.now\(\) - em > VALIDADE_DO_CACHE/);
    });

    it('sobrevive a storage indisponível', () => {
        // Navegador com storage desligado (ou cota estourada) não pode derrubar
        // a barra lateral que hospeda o selo.
        const corpo = script();
        const trechos = corpo.split('sessionStorage');
        // Toda leitura/escrita mora dentro de um try.
        expect(trechos.length).toBeGreaterThan(1);
        expect(corpo).toMatch(/try \{[\s\S]*?sessionStorage\.getItem/);
        expect(corpo).toMatch(/try \{[\s\S]*?sessionStorage\.setItem/);
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
