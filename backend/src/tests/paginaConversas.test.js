/**
 * paginaConversas.test.js — as páginas de conversas (Issues #71 e #83).
 *
 * O QUE VALE TESTAR NUMA PÁGINA ESTÁTICA
 * --------------------------------------
 * Não o visual. O que quebra de verdade em HTML servido por `express.static`
 * são duas coisas, e as duas quebram em SILÊNCIO:
 *
 *   1. um caminho de asset com erro de digitação — a página carrega, só que
 *      sem estilo ou sem script, e ninguém percebe até alguém abrir a tela;
 *
 *   2. o contrato por ID entre a página e `js/chat-direto-manager.js`. Os
 *      dois arquivos não se importam: o que os liga é o manager procurar
 *      `#chatWindowsContainer` e a página fornecer esse elemento dentro do
 *      painel. Renomear de um lado só faz a conversa voltar a flutuar sobre a
 *      tela em vez de ancorar — sem erro nenhum no console.
 *
 * Um teste de renderização não pegaria nenhuma das duas.
 *
 * DUAS PÁGINAS, MESMO CONTRATO
 * -----------------------------
 * `html/conversas.html` (compartilhada, fora de qualquer área restrita) e
 * `html/direcao/conversas.html` (só admin/diretor, Issue #83) usam o mesmo
 * shell e o mesmo `js/conversas.js` — só o gate de acesso e o botão de voltar
 * mudam. As duas precisam do mesmo contrato com o manager, então rodam a
 * mesma bateria de testes.
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(RAIZ, 'js', 'conversas.js');
const MANAGER = path.join(RAIZ, 'js', 'chat-direto-manager.js');

const PAGINAS = [
    ['html/conversas.html', 'compartilhada'],
    ['html/direcao/conversas.html', 'exclusiva da direção'],
];

const script = fs.readFileSync(SCRIPT, 'utf8');

describe.each(PAGINAS)('%s (%s)', (relPagina) => {
    const PAGINA = path.join(RAIZ, relPagina);
    let html;
    beforeAll(() => {
        html = fs.readFileSync(PAGINA, 'utf8');
    });

    describe('assets referenciados existem no disco', () => {
        /** Caminhos locais de `href=` e `src=`; ignora http(s), data: e âncoras. */
        function caminhosLocais(markup) {
            const achados = [...markup.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
            return achados.filter((c) => !/^(https?:|data:|blob:|#|mailto:)/i.test(c));
        }

        it('todo href/src local aponta para um arquivo que existe', () => {
            const quebrados = [];
            for (const caminho of caminhosLocais(html)) {
                // A query de cache-busting (?v=1.0) não faz parte do nome do arquivo.
                const semQuery = caminho.split('?')[0];
                const absoluto = path.resolve(path.dirname(PAGINA), semQuery);
                if (!fs.existsSync(absoluto)) quebrados.push(caminho);
            }
            expect(quebrados).toEqual([]);
        });

        it('referencia os scripts de que depende', () => {
            // Sem estes três a tela abre e não faz nada: sem manager não há
            // conversa, sem realtime não há socket, sem conversas.js não há lista.
            expect(html).toContain('chat-direto-manager.js');
            expect(html).toContain('realtime.js');
            expect(html).toContain('conversas.js');
        });
    });

    describe('contrato com o chat-direto-manager', () => {
        it('a página fornece o container que o manager procura', () => {
            // O manager só cria o container dele se não achar este id
            // (createContainer). É o que faz a janela nascer ancorada no painel.
            expect(html).toContain('id="chatWindowsContainer"');
            expect(fs.readFileSync(MANAGER, 'utf8')).toContain(
                "getElementById('chatWindowsContainer')"
            );
        });

        it('a lista abre a conversa pela API pública do manager', () => {
            // `window.abrirChatCom` é o ponto de entrada exposto pelo manager. Usar
            // o interno (`chatManager.openChat`) acoplaria a página a um detalhe.
            expect(script).toContain('window.abrirChatCom');
            expect(fs.readFileSync(MANAGER, 'utf8')).toContain('window.abrirChatCom');
        });
    });

    describe('a tela não decide permissão', () => {
        it('consome o endpoint de contatos permitidos', () => {
            // Listar a escola inteira e filtrar no cliente entregaria no HTML os
            // nomes de todos os professores e famílias para um responsável.
            expect(script).toContain('/chat-direto/contatos');
        });

        it('não consulta rotas de listagem ampla de usuários', () => {
            for (const rotaProibida of ['/usuarios', '/professores', '/alunos']) {
                expect(script).not.toContain(rotaProibida);
            }
        });
    });

    describe('conteúdo vindo do servidor não vira marcação', () => {
        it('a lista é montada sem innerHTML', () => {
            // Nome de pessoa é texto digitado por gente. Um nome com "<" viraria
            // marcação; `textContent` fecha isso por construção.
            expect(script).not.toMatch(/\.innerHTML\s*=/);
            expect(script).toContain('textContent');
        });
    });

    describe('motion', () => {
        it('usa o skeleton e os tokens de css/motion.css, sem animação própria', () => {
            expect(html).toContain('motion.css');
            expect(html).toContain('skeleton');
            // `@keyframes` aqui significaria motion novo fora do arquivo central —
            // ver AGENTS.md §8 e docs/MOTION.md.
            expect(html).not.toContain('@keyframes');
        });
    });
});

/**
 * A página existia e ninguém chegava nela.
 *
 * Este bloco não testa o chat — testa a DESCOBERTA. `html/conversas.html` foi
 * entregue sem nenhum link apontando para ela: a tela funcionava e era
 * inalcançável pela interface, o que na prática é o mesmo que não existir.
 *
 * Um teste de asset não pega isso, porque o defeito não está na página e sim
 * na ausência dela em outro arquivo.
 */

describe('a página exclusiva da direção não vaza para outros perfis', () => {
    it('o botão de voltar leva ao portal da direção, não ao dashboard genérico', () => {
        const html = fs.readFileSync(path.join(RAIZ, 'html/direcao/conversas.html'), 'utf8');
        expect(html).toMatch(/class="conv-voltar" href="index\.html"/);
    });
});

/**
 * O "voltar" levava o responsável para o painel do professor.
 *
 * A tela compartilhada é o ÚNICO ponto do sistema em HTML puro que o
 * responsável alcança — ele chega vindo do portal React. O link de voltar
 * estava fixo em `dashboard.html`, então clicar em "voltar" o depositava numa
 * tela de professor, com a barra lateral da escola, e sem nada que o levasse de
 * volta ao portal. Só o `perfil` de quem abriu decide esse destino, e ele não
 * era consultado.
 *
 * São três peças em três arquivos que não se conhecem: o atributo no HTML, o
 * seletor no script e o mapa de destinos — que precisa ser o MESMO do servidor,
 * senão o link abre e toma um redirecionamento na cara da pessoa.
 */
describe('o "voltar" da tela compartilhada respeita o perfil', () => {
    const blocoDePaineis = script.slice(
        script.indexOf('const PAINEL_POR_PERFIL'),
        script.indexOf('async function meuPerfil')
    );

    it('a página marca o link para o script reescrever', () => {
        const html = fs.readFileSync(path.join(RAIZ, 'html/conversas.html'), 'utf8');
        expect(html).toMatch(/class="conv-voltar"[^>]*data-voltar-perfil/);
    });

    it('o script procura exatamente o atributo que a página marca', () => {
        // Renomear de um lado só faz o link voltar a ser fixo, em silêncio.
        expect(script).toContain('.conv-voltar[data-voltar-perfil]');
    });

    /** O `url:` declarado para um perfil dentro do mapa do script. */
    function urlDoPerfil(perfil) {
        const inicio = blocoDePaineis.indexOf(`${perfil}:`);
        if (inicio < 0) return null;

        const depois = blocoDePaineis.slice(inicio);
        const marca = depois.indexOf("url: '");
        if (marca < 0) return null;

        const valor = depois.slice(marca + "url: '".length);
        return valor.slice(0, valor.indexOf("'"));
    }

    it('o destino de cada perfil é o mesmo que o servidor usaria', () => {
        const { PAINEL_POR_PERFIL } = require('../utils/painelPorPerfil');

        // Divergir aqui dá o pior dos casos: o link abre e o servidor
        // redireciona na hora — uma volta de navegação que ninguém pediu.
        for (const [perfil, url] of Object.entries(PAINEL_POR_PERFIL)) {
            expect(`${perfil} -> ${urlDoPerfil(perfil)}`).toBe(`${perfil} -> ${url}`);
        }
    });

    it('o script cobre todos os perfis que o servidor conhece', () => {
        const { PAINEL_POR_PERFIL } = require('../utils/painelPorPerfil');
        // Um perfil de fora do mapa cai no fallback do HTML — que é o dashboard.
        // Foi assim que o responsável chegou lá.
        for (const perfil of Object.keys(PAINEL_POR_PERFIL)) {
            expect(blocoDePaineis).toContain(`${perfil}:`);
        }
    });

    it('a tela da direção fica de fora — ela tem destino próprio', () => {
        // Sem o atributo, o script não toca no link: /html/direcao/conversas.html
        // volta para o painel da direção, não para o dashboard genérico.
        const html = fs.readFileSync(path.join(RAIZ, 'html/direcao/conversas.html'), 'utf8');
        expect(html).not.toContain('data-voltar-perfil');
    });
});

/**
 * A defesa real não é o link — é o gate.
 *
 * O link certo conserta a navegação; ele não impede ninguém de digitar a URL,
 * usar o histórico ou clicar num link antigo. Quem fecha o dashboard para o
 * responsável é `middleware/protegerPaginas.js`, e ele deriva a lista de perfis
 * do MESMO mapa que o redirecionamento usa.
 */
describe('o dashboard é fechado para o responsável — e só para ele', () => {
    const { AREAS } = require('../middleware/protegerPaginas');
    const { PAINEL_POR_PERFIL, PAINEL_DASHBOARD } = require('../utils/painelPorPerfil');

    const doGate = () => AREAS[PAINEL_DASHBOARD].perfis;

    it('a área existe no gate', () => {
        expect(AREAS[PAINEL_DASHBOARD]).toBeDefined();
    });

    it('o responsável não entra — o defeito que originou tudo isto', () => {
        expect(doGate()).not.toContain('responsavel');
    });

    it('quem MORA no dashboard consegue abri-lo', () => {
        // A trava contra fechar demais. A primeira versão derivava a lista de
        // "quem mora aqui" e, por elegância, deixava a secretaria de fora —
        // transformando o botão "Dashboard" do painel dela num no-op. Este
        // teste garante o piso: ninguém que o login manda para cá pode
        // encontrar a porta fechada.
        const moradores = Object.keys(PAINEL_POR_PERFIL).filter(
            (p) => PAINEL_POR_PERFIL[p] === PAINEL_DASHBOARD
        );

        for (const perfil of moradores) {
            expect(`${perfil} entra: ${doGate().includes(perfil)}`).toBe(`${perfil} entra: true`);
        }
    });

    it('a secretaria continua entrando, mesmo tendo painel próprio', () => {
        // `html/secretaria/painel.html` tem um botão "Dashboard" no cabeçalho e
        // `js/dashboard.js` desenha cards e barra lateral de secretaria. Tirá-la
        // daqui quebra uma tela que funcionava.
        expect(doGate()).toContain('secretaria');
    });

    it('negar aqui redireciona ao painel da pessoa, não a um 404', () => {
        // A página existe e a pessoa está autenticada: mandá-la para o erro
        // seria trocar uma tela errada por um beco sem saída.
        expect(AREAS[PAINEL_DASHBOARD].redirecionarAoPainel).toBe(true);
    });
});
