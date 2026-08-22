/**
 * paginaConversas.test.js — a página de conversas (Issue #71).
 *
 * O QUE VALE TESTAR NUMA PÁGINA ESTÁTICA
 * --------------------------------------
 * Não o visual. O que quebra de verdade em HTML servido por `express.static`
 * são duas coisas, e as duas quebram em SILÊNCIO:
 *
 *   1. um caminho de asset com erro de digitação — a página carrega, só que
 *      sem estilo ou sem script, e ninguém percebe até alguém abrir a tela;
 *
 *   2. o contrato por ID entre `html/conversas.html` e
 *      `js/chat-direto-manager.js`. Os dois arquivos não se importam: o que os
 *      liga é o manager procurar `#chatWindowsContainer` e a página fornecer
 *      esse elemento dentro do painel. Renomear de um lado só faz a conversa
 *      voltar a flutuar sobre a tela em vez de ancorar — sem erro nenhum no
 *      console.
 *
 * Um teste de renderização não pegaria nenhuma das duas.
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const PAGINA = path.join(RAIZ, 'html', 'conversas.html');
const SCRIPT = path.join(RAIZ, 'js', 'conversas.js');
const MANAGER = path.join(RAIZ, 'js', 'chat-direto-manager.js');

let html;
let script;

beforeAll(() => {
    html = fs.readFileSync(PAGINA, 'utf8');
    script = fs.readFileSync(SCRIPT, 'utf8');
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
