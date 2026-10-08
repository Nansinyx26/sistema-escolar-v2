/**
 * paginaDenuncias.test.js — a página de denúncias recebidas (Issue #726).
 *
 * Mesmo padrão de `paginaModeracao.test.js`: a tela é só o shell, a proteção
 * real está na API (`denunciasRecebidas.test.js`). Aqui se verifica que o shell
 * não mente — não referencia arquivo inexistente, mora numa área que o gate já
 * fecha para os três perfis certos, e não monta o relato como marcação.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const PAGINA = path.join(RAIZ, 'html/secretaria/denuncias.html');
const SCRIPT = path.join(RAIZ, 'js/moderacao/denuncias.js');

const html = fs.readFileSync(PAGINA, 'utf8');
const script = fs.readFileSync(SCRIPT, 'utf8');

describe('html/secretaria/denuncias.html', () => {
    it('todo href/src local aponta para um arquivo que existe', () => {
        const achados = [...html.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
        const locais = achados.filter((c) => !/^(https?:|data:|blob:|#|mailto:)/i.test(c));

        const quebrados = locais.filter((caminho) => {
            const semQuery = caminho.split('?')[0];
            const base = semQuery.startsWith('/') ? RAIZ : path.dirname(PAGINA);
            return !fs.existsSync(path.resolve(base, `.${path.sep}${semQuery.replace(/^\//, '')}`));
        });

        expect(quebrados).toEqual([]);
    });

    it('carrega o guard de acesso, o script da página e o helper de CSRF', () => {
        expect(html).toContain('/js/guarda-acesso.js');
        expect(html).toContain('moderacao/denuncias.js');
        // O andamento é POST; sem o helper, o CSRF barra tudo.
        expect(html).toContain('csrf-helper.js');
    });

    it('mora em /html/secretaria, que o gate fecha para admin, diretor e secretaria', () => {
        const { AREAS } = require('../middleware/protegerPaginas');
        expect([...AREAS['/html/secretaria'].perfis].sort()).toEqual(
            ['admin', 'diretor', 'secretaria'].sort()
        );
    });

    it('tem link no painel da secretaria e no dashboard da direção', () => {
        const painel = fs.readFileSync(path.join(RAIZ, 'html/secretaria/painel.html'), 'utf8');
        const dashboard = fs.readFileSync(path.join(RAIZ, 'html/dashboard.html'), 'utf8');
        expect(painel).toContain('href="denuncias.html"');
        expect(dashboard).toMatch(
            /href="secretaria\/denuncias\.html" class="sidebar-item director-only"/
        );
    });

    it('não usa innerHTML: relato e anotação são texto livre', () => {
        expect(script).not.toMatch(/\.innerHTML\s*=/);
        expect(script).not.toContain('insertAdjacentHTML');
        expect(script).toContain('textContent');
    });

    it('pede o relato só ao abrir a denúncia, não na listagem', () => {
        // A listagem e o detalhe são rotas diferentes; o detalhe é o que vai
        // ao AuditLog. O script não pode pedir todos os detalhes de uma vez.
        expect(script).toMatch(/alternarDetalhe/);
        expect(script).not.toMatch(/Promise\.all\([^)]*denuncia/);
    });

    describe('motion', () => {
        it('usa os tokens de css/motion.css, sem animação própria', () => {
            expect(html).toContain('motion.css');
            expect(html).not.toContain('@keyframes');
        });

        it('mostra skeleton enquanto carrega e usa as APIs que o motion.js expõe', () => {
            expect(script).toContain('Motion.skeleton');
            expect(script).toContain('Motion.reveal');
            // A classe `motion-reveal` posta à mão esconde o cartão para sempre:
            // só o `Motion.reveal` sobre `data-reveal` o torna visível.
            expect(script).toContain("'data-reveal'");
            expect(script).not.toMatch(/no\('article', '[^']*motion-reveal/);
        });
    });
});
