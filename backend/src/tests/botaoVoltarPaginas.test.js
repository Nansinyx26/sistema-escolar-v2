/**
 * botaoVoltarPaginas.test.js — toda página interna carrega o botão Voltar padronizado.
 *
 * A Issue #259 pede o mesmo botão em todas as páginas internas. O PR #260 cobriu
 * parte delas e dezoito ficaram com o botão antigo, de link fixo, sem que nada
 * acusasse. Este teste fecha essa porta: página nova em `html/`, `direcao/`,
 * `detalhes/` ou `graficos/` precisa carregar `js/botao-voltar.js` ou entrar na
 * lista de exceções abaixo, com o motivo escrito.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const PASTAS = ['html', 'direcao', 'detalhes', 'graficos'];

// Página fora do padrão precisa de motivo. Uma exceção sem motivo é só um
// esquecimento com outro nome.
const EXCECOES = {
    // Públicas ou de autenticação: não há sessão, então não há painel para voltar.
    'html/login.html': 'tela de login',
    'html/login-diretor.html': 'tela de login',
    'html/login-professor.html': 'tela de login',
    'html/login-secretaria.html': 'tela de login',
    'html/admin/entrar.html': 'tela de login do admin',
    'html/escolher-perfil.html': 'escolha de perfil antes do login',
    'html/cadastro-diretor.html': 'cadastro antes do login',
    'html/cadastro-professor.html': 'cadastro antes do login',
    'html/pages/cadastro-diretor-publico.html': 'cadastro público',
    'html/pages/cadastro-docente.html': 'cadastro público',
    'html/pages/cadastro-responsavel.html': 'cadastro público',
    'html/pages/cadastro-secretaria-publico.html': 'cadastro público',
    'html/primeiro-acesso.html': 'fluxo de primeiro acesso',
    'html/pages/primeiro-acesso.html': 'fluxo de primeiro acesso',
    'html/reset-password.html': 'redefinição de senha por link de e-mail',
    'html/politica-privacidade.html': 'página pública',
    'html/404.html': 'página de erro',
    'html/500.html': 'página de erro',
    'html/offline.html': 'página de fallback do service worker',
    // Fluxos que não podem ser abandonados por um Voltar genérico.
    'html/mudar-senha.html': 'troca de senha obrigatória: voltar pularia a troca',
    'html/admin/cadastro-secretaria.html':
        'o Voltar do formulário pede confirmação antes de descartar os dados; um botão genérico pularia a confirmação',
    // Voltar com destino por perfil, que o histórico da sessão não cobre.
    'html/conversas.html':
        'o voltar aponta para o painel do perfil, inclusive o portal do responsável (Issue #101)',
    'html/direcao/conversas.html': 'mesma tela de conversas, versão da direção',
    // Ferramentas de desenvolvimento, fora da navegação do produto.
    'html/design-system.html': 'vitrine de componentes',
    'html/diagnostico-audio.html': 'ferramenta de diagnóstico de áudio',
    'html/utils/limpar-dados.html': 'utilitário de desenvolvimento',
    'html/utils/test-backend.html': 'utilitário de desenvolvimento',
};

function listarHtml(pasta) {
    const abs = path.join(RAIZ, pasta);
    return fs.readdirSync(abs, { withFileTypes: true }).flatMap((ent) => {
        const rel = `${pasta}/${ent.name}`;
        if (ent.isDirectory()) return listarHtml(rel);
        return ent.name.endsWith('.html') ? [rel] : [];
    });
}

const paginas = PASTAS.flatMap(listarHtml).sort();
const internas = paginas.filter((p) => !(p in EXCECOES));

describe('botão Voltar padronizado nas páginas internas (Issue #259)', () => {
    it('encontra as páginas a verificar', () => {
        expect(internas.length).toBeGreaterThan(30);
    });

    // Só o script é exigido: ele registra a página no histórico da sessão e, se
    // o CSS do botão faltar, inclui o arquivo sozinho. Os painéis principais
    // carregam só o script, para zerar o histórico, e escondem o botão.
    it.each(internas)('%s carrega o botão Voltar padronizado', (pagina) => {
        const html = fs.readFileSync(path.join(RAIZ, pagina), 'utf8');
        expect(html).toMatch(/<script[^>]+src="[^"]*js\/botao-voltar\.js"/);
    });

    it.each(Object.keys(EXCECOES))('a exceção %s aponta para uma página que existe', (pagina) => {
        expect(fs.existsSync(path.join(RAIZ, pagina))).toBe(true);
    });

    it('o mural de notificações não mantém um segundo tratador no botão Voltar', () => {
        const js = fs.readFileSync(path.join(RAIZ, 'direcao/direcao-notificacoes.js'), 'utf8');
        expect(js).not.toMatch(/getElementById\('btnVoltar'\)/);
    });
});
