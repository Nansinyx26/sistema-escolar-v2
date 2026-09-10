/**
 * @jest-environment jsdom
 */

const NavegacaoVoltar = require('../../../js/botao-voltar.js');

describe('js/botao-voltar.js - Navegação Inteligente e Histórico', () => {
    let originalLocation;

    beforeEach(() => {
        sessionStorage.clear();
        delete window.currentUser;
        delete window.user_role;
        originalLocation = window.location;
    });

    afterEach(() => {
        if (originalLocation) {
            window.location = originalLocation;
        }
    });

    it('identifica corretamente páginas de dashboard', () => {
        expect(NavegacaoVoltar.isDashboardUrl('/html/direcao/index.html')).toBe(true);
        expect(NavegacaoVoltar.isDashboardUrl('/html/secretaria/painel.html')).toBe(true);
        expect(NavegacaoVoltar.isDashboardUrl('/html/dashboard.html')).toBe(true);
        expect(NavegacaoVoltar.isDashboardUrl('/portal-responsavel/dist/index.html')).toBe(true);
        expect(NavegacaoVoltar.isDashboardUrl('/detalhes/alunos.html')).toBe(false);
        expect(NavegacaoVoltar.isDashboardUrl('/detalhes/autorizacoes-pais.html')).toBe(false);
    });

    it('ao visitar um dashboard, reseta a pilha para conter apenas o dashboard', () => {
        NavegacaoVoltar.setStack(['/detalhes/alunos.html', '/html/turma.html']);
        expect(NavegacaoVoltar.getStack().length).toBe(2);

        NavegacaoVoltar.registrarPaginaAtual('/html/direcao/index.html');
        const stack = NavegacaoVoltar.getStack();
        expect(stack).toEqual(['/html/direcao/index.html']);
    });

    it('não duplica entradas consecutivas na pilha (F5 ou recarregamento)', () => {
        NavegacaoVoltar.setStack([]);
        NavegacaoVoltar.registrarPaginaAtual('/html/direcao/index.html');
        NavegacaoVoltar.registrarPaginaAtual('/detalhes/autorizacoes-pais.html');
        NavegacaoVoltar.registrarPaginaAtual('/detalhes/autorizacoes-pais.html'); // F5
        const stack = NavegacaoVoltar.getStack();
        expect(stack).toEqual(['/html/direcao/index.html', '/detalhes/autorizacoes-pais.html']);
    });

    it('retorna a página anterior correta da pilha e desempilha ao voltar', () => {
        delete window.location;
        window.location = {
            pathname: '/detalhes/alunos.html',
            search: '',
            href: '/detalhes/alunos.html',
        };

        NavegacaoVoltar.setStack([
            '/html/dashboard.html',
            '/detalhes/turmas.html',
            '/detalhes/alunos.html',
        ]);

        expect(NavegacaoVoltar.obterUrlVoltar()).toBe('/detalhes/turmas.html');
        const destino = NavegacaoVoltar.voltar();
        expect(destino).toBe('/detalhes/turmas.html');
    });

    it('resolve o fallback por perfil armazenado no sessionStorage', () => {
        sessionStorage.setItem('currentUser', JSON.stringify({ perfil: 'diretor' }));
        expect(NavegacaoVoltar.getFallbackDashboard()).toBe('/html/direcao/index.html');

        sessionStorage.setItem('currentUser', JSON.stringify({ perfil: 'secretaria' }));
        expect(NavegacaoVoltar.getFallbackDashboard()).toBe('/html/secretaria/painel.html');

        sessionStorage.setItem('currentUser', JSON.stringify({ perfil: 'professor' }));
        expect(NavegacaoVoltar.getFallbackDashboard()).toBe('/html/dashboard.html');

        sessionStorage.setItem('currentUser', JSON.stringify({ perfil: 'responsavel' }));
        expect(NavegacaoVoltar.getFallbackDashboard()).toBe('/portal-responsavel/dist/index.html');

        sessionStorage.setItem('currentUser', JSON.stringify({ perfil: 'desconhecido' }));
        expect(NavegacaoVoltar.getFallbackDashboard()).toBe('/html/dashboard.html');
    });

    it('conecta elementos com a classe .btn-voltar-global ao evento de clique', () => {
        document.body.innerHTML = `
            <div class="navbar">
                <a href="javascript:void(0)" class="btn-voltar-global" id="btnVoltar">Voltar</a>
            </div>
        `;
        delete window.location;
        window.location = {
            pathname: '/detalhes/autorizacoes-pais.html',
            search: '',
            href: '',
        };

        NavegacaoVoltar.setStack(['/html/direcao/index.html', '/detalhes/autorizacoes-pais.html']);

        NavegacaoVoltar.montarInterface();

        const btn = document.getElementById('btnVoltar');
        btn.click();

        expect(window.location.href).toBe('/html/direcao/index.html');
    });
});
