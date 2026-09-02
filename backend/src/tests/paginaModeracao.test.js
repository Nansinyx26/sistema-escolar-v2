/**
 * paginaModeracao.test.js — o painel da Fase 0 e o modal de aceite do Termo.
 *
 * Mesmo padrão de `paginaConversas.test.js`: a tela é só o shell, a proteção
 * real está na API. O que se verifica aqui é que o shell não mente — que não
 * referencia arquivo inexistente, que não decide permissão por conta própria e
 * que não monta conteúdo do servidor como marcação.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const PAGINA = path.join(RAIZ, 'html/direcao/moderacao.html');
const PAINEL = path.join(RAIZ, 'js/moderacao/painel.js');
const TERMO = path.join(RAIZ, 'js/termo-audio-imagem.js');
const CHAT = path.join(RAIZ, 'js/chat-direto-manager.js');
const PAGINA_TERMO = path.join(RAIZ, 'html/termo-audio-imagem.html');

const html = fs.readFileSync(PAGINA, 'utf8');
const painel = fs.readFileSync(PAINEL, 'utf8');
const termo = fs.readFileSync(TERMO, 'utf8');
const chat = fs.readFileSync(CHAT, 'utf8');
const paginaTermo = fs.readFileSync(PAGINA_TERMO, 'utf8');

describe('html/direcao/moderacao.html', () => {
    it('todo href/src local aponta para um arquivo que existe', () => {
        const achados = [...html.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
        const locais = achados.filter((c) => !/^(https?:|data:|blob:|#|mailto:)/i.test(c));

        const quebrados = locais.filter((caminho) => {
            const semQuery = caminho.split('?')[0];
            // Caminho iniciado por '/' é relativo à RAIZ DO SITE, não ao diretório
            // da página — é assim que o navegador resolve, e é a forma usada por
            // `/manifest.json` e pelo guard de acesso. Resolver tudo contra
            // `dirname(PAGINA)` dava um caminho absoluto do sistema de arquivos
            // (`/js/...`), que nunca existe, e reprovava uma referência correta.
            const base = semQuery.startsWith('/') ? RAIZ : path.dirname(PAGINA);
            return !fs.existsSync(path.resolve(base, `.${path.sep}${semQuery.replace(/^\//, '')}`));
        });

        expect(quebrados).toEqual([]);
    });

    it('carrega o script do painel e o helper de CSRF', () => {
        expect(html).toContain('moderacao/painel.js');
        // Toda decisão do painel é POST; sem o helper, o CSRF barra tudo.
        expect(html).toContain('csrf-helper.js');
    });

    it('vive em /html/direcao, que o gate já fecha para admin e diretor', () => {
        const { AREAS } = require('../middleware/protegerPaginas');
        expect(AREAS['/html/direcao'].perfis).toEqual(expect.arrayContaining(['admin', 'diretor']));
    });

    describe('motion', () => {
        it('usa os tokens de css/motion.css, sem animação própria', () => {
            expect(html).toContain('motion.css');
            // `@keyframes` aqui significaria motion novo fora do arquivo central.
            expect(html).not.toContain('@keyframes');
        });

        it('o painel mostra skeleton enquanto carrega', () => {
            expect(painel).toContain('Motion.skeleton');
            expect(painel).toContain('mostrarEsqueleto');
        });

        it('usa as APIs que o motion.js realmente expõe', () => {
            // `Motion.observar` não existe — a API é `reveal`. Um nome errado
            // aqui não quebra nada em tempo de execução: só desliga a animação
            // em silêncio, e ninguém percebe até alguém reparar que a tela
            // "apareceu seca".
            expect(painel).toContain('Motion.reveal');
            expect(painel).not.toContain('Motion.observar');

            const motionJs = fs.readFileSync(path.join(RAIZ, 'js/motion.js'), 'utf8');
            expect(motionJs).toContain('reveal');
        });
    });
});

describe('js/moderacao/painel.js — o que a tela não faz', () => {
    it('não monta conteúdo do servidor como marcação', () => {
        // A ocorrência traz perfil, termos e datas vindos do banco. `innerHTML`
        // aqui transformaria conteúdo em markup.
        expect(painel).not.toMatch(/\.innerHTML\s*=/);
        expect(painel).toContain('textContent');
    });

    it('não decide permissão — só consome /api/moderacao', () => {
        expect(painel).toContain('/api/moderacao');
        // Nada de checar perfil no cliente para liberar botão: quem autoriza é
        // authorize.estrito no servidor.
        expect(painel).not.toMatch(/perfil\s*===\s*['"](admin|diretor)['"]/);
    });

    it('sabe repassar o escolaId que o admin precisa informar (R4)', () => {
        expect(painel).toContain('escolaId');
        expect(painel).toContain('ESCOLA_NAO_INFORMADA');
    });

    it('usa o helper de CSRF que existe de fato', () => {
        // `window.csrfHeaders(json)` — não `csrfHeader()`.
        expect(painel).toContain('csrfHeaders');

        const helper = fs.readFileSync(path.join(RAIZ, 'js/csrf-helper.js'), 'utf8');
        expect(helper).toContain('window.csrfHeaders');
    });
});

describe('js/termo-audio-imagem.js — cláusula 2', () => {
    it('consulta e registra o aceite no endpoint do Termo', () => {
        expect(termo).toContain('/api/moderacao/aceite-termo');
    });

    it('intercepta o clique na CAPTURA, antes do handler do chat', () => {
        // Sem a fase de captura, o gravador de áudio abriria antes de a pessoa
        // ver o Termo — o aceite viraria decorativo.
        expect(termo).toMatch(/addEventListener\(\s*'click',[\s\S]*?true\s*\)/);
    });

    it('falha ABERTA quando não consegue consultar o aceite', () => {
        // Trancar o chat da escola porque uma verificação não voltou seria
        // trocar um problema jurídico por um problema operacional maior.
        expect(termo).toContain('aceito === null');
    });

    it('está carregado nas duas telas de conversa', () => {
        for (const rel of ['html/conversas.html', 'html/direcao/conversas.html']) {
            const pagina = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
            expect(pagina).toContain('termo-audio-imagem.js');
            expect(pagina).toContain('termo-audio-imagem.css');
        }
    });
});

describe('caminho até o aceite do Termo (Issue #189)', () => {
    /**
     * A regressão que motivou a Issue: os quatro seletores originais do
     * `termo-audio-imagem.js` não existiam em lugar nenhum do compositor do
     * chat. A cortesia de interface nunca ligava, o modal nunca abria, e a
     * única notícia do Termo que a pessoa recebia era o 403 do servidor —
     * depois de já ter gravado o áudio. Estes testes amarram os dois arquivos:
     * mexer no nome dos botões do chat sem mexer aqui volta a quebrar o
     * caminho, e agora falha no CI em vez de falhar na escola.
     */
    it('bloqueia seletores que existem de verdade no compositor do chat', () => {
        for (const seletor of ['.chat-btn-mic', '[id^="btnMic_"]', '[id^="btnAttach_"]']) {
            expect(termo).toContain(seletor);
        }

        expect(chat).toContain('chat-btn-mic');
        expect(chat).toContain('btnMic_');
        expect(chat).toContain('btnAttach_');
    });

    it('reaplica o estado nas janelas de conversa montadas depois do load', () => {
        // O chat monta a janela quando alguém abre um contato, muito depois do
        // DOMContentLoaded: sem observador, o indicador de bloqueio não
        // apareceria em janela nenhuma.
        expect(termo).toContain('MutationObserver');
    });

    it('oferece a página completa do Termo dentro do modal', () => {
        expect(termo).toContain('/html/termo-audio-imagem.html');
    });

    it('tem entrada para a página do Termo em toda tela com sidebar', () => {
        const telas = [
            'html/dashboard.html',
            'html/direcao/index.html',
            'html/direcao/gerenciar-secretaria.html',
            'html/conversas.html',
            'html/direcao/conversas.html',
        ];

        for (const rel of telas) {
            const pagina = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
            expect(pagina).toContain('termo-audio-imagem.html');
        }
    });
});

/**
 * html/termo-audio-imagem.html — o único lugar do sistema onde qualquer perfil
 * assina um termo. Issue #201.
 */
describe('html/termo-audio-imagem.html — consentimento e retorno', () => {
    it('pede o consentimento LGPD junto do aceite do Termo', () => {
        // Sem este checkbox o POST registraria um consentimento que ninguém
        // marcou — consentimento presumido não é consentimento.
        expect(paginaTermo).toContain('id="checkConsentimentoLgpd"');
        expect(paginaTermo).toContain('politica-privacidade.html');
        expect(paginaTermo).toContain('13.709');
    });

    it('mostra o estado dos DOIS consentimentos', () => {
        // Quem já tinha o Termo aceito antes da Issue #201 precisa ver que o
        // consentimento LGPD ainda está pendente — e ter como registrá-lo.
        expect(paginaTermo).toContain('id="statusDotLgpd"');
        expect(paginaTermo).toContain('id="statusLgpdTitulo"');
        expect(paginaTermo).toMatch(/termo\.aceito !== true \|\| lgpd\.aceito !== true/);
    });

    it('leva o registro para Meus Dados, e diz isso na tela', () => {
        expect(paginaTermo).toContain('meus-dados.html');
    });

    it('devolve o Voltar ao painel do perfil, sem repetir a tabela de painéis', () => {
        // O fallback era `perfil.html`, que não é a casa de perfil nenhum: o
        // responsável caía numa tela do lado escolar em vez do portal dele.
        // A tabela vem do guard (espelho de utils/painelPorPerfil.js) — uma
        // terceira cópia dos caminhos divergiria na primeira mudança.
        expect(paginaTermo).toContain('GuardaAcesso.painelDoPerfil');
        expect(paginaTermo).not.toContain('href="perfil.html" class="btn-voltar"');
    });

    it('confere o referrer contra o mesmo veredito de acesso do guard', () => {
        // Um responsável com o dashboard no referrer seria devolvido para uma
        // página que o gate do servidor não deixa ele abrir.
        expect(paginaTermo).toContain(
            'guarda.permitido(guarda.vereditoDe(origem.pathname), perfil)'
        );
    });

    it('carrega o guard de acesso, de onde a tabela de painéis vem', () => {
        expect(paginaTermo).toContain('/js/guarda-acesso.js');
    });

    it('mostra o consentimento registrado também na conta (perfil.html)', () => {
        // "Gravar no banco" só serve se a conta mostrar. A tela do perfil já
        // tinha a seção do Termo; o consentimento LGPD entra na mesma seção,
        // lido do mesmo endpoint.
        const perfilHtml = fs.readFileSync(path.join(RAIZ, 'html/perfil.html'), 'utf8');
        const perfilJs = fs.readFileSync(path.join(RAIZ, 'js/perfil.js'), 'utf8');

        expect(perfilHtml).toContain('id="linhaConsentimentoLgpd"');
        expect(perfilJs).toContain('mostrarConsentimentoLgpd');
        expect(perfilJs).toContain('consentimentoLgpd');
    });
});
