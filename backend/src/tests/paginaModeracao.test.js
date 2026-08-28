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

const html = fs.readFileSync(PAGINA, 'utf8');
const painel = fs.readFileSync(PAINEL, 'utf8');
const termo = fs.readFileSync(TERMO, 'utf8');

describe('html/direcao/moderacao.html', () => {
    it('todo href/src local aponta para um arquivo que existe', () => {
        const achados = [...html.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
        const locais = achados.filter((c) => !/^(https?:|data:|blob:|#|mailto:)/i.test(c));

        const quebrados = locais.filter((caminho) => {
            const semQuery = caminho.split('?')[0];
            return !fs.existsSync(path.resolve(path.dirname(PAGINA), semQuery));
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
