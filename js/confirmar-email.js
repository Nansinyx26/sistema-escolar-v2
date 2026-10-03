/**
 * confirmar-email.js — página aberta pelo link da troca de e-mail (Issue #609).
 *
 * Abrir o link não troca nada: leitores de e-mail e antivírus abrem links
 * sozinhos. A troca só acontece no clique, e o servidor só a aceita na conta
 * que a pediu. Os dados da conta entram por `textContent`, nunca por HTML.
 *
 * O token vem no fragmento (`#token=`), que não sai do navegador. Ele fica na
 * barra de endereço até a troca dar certo, para que quem precise entrar na
 * conta antes consiga voltar a esta aba e tentar de novo.
 */
(function () {
    'use strict';

    var ESTADOS = [
        'esqueleto',
        'estado-confirmar',
        'estado-sem-sessao',
        'estado-sucesso',
        'estado-problema',
    ];

    var token = (new URLSearchParams(window.location.hash.slice(1)).get('token') || '').trim();

    function $(id) {
        return document.getElementById(id);
    }

    /**
     * Troca o estado visível. Depois de um clique, o foco vai para o título do
     * estado novo, para o leitor de tela anunciá-lo; na carga da página o
     * `aria-live` do cartão basta, e mover o foco ali pintaria o anel de foco
     * num título que não é controle.
     */
    function mostrar(id, focar) {
        ESTADOS.forEach(function (outro) {
            $(outro).hidden = outro !== id;
        });
        var titulo = $(id).querySelector('h1');
        if (focar && titulo) {
            titulo.setAttribute('tabindex', '-1');
            titulo.focus({ preventScroll: true });
        }
    }

    function problema(mensagem, focar) {
        $('problema-mensagem').textContent = mensagem;
        mostrar('estado-problema', focar);
    }

    function api(caminho) {
        return (window.API_BASE_URL || '/api') + caminho;
    }

    async function lerJson(res) {
        try {
            return await res.json();
        } catch {
            return {};
        }
    }

    async function carregarConta(focar) {
        if (!/^[a-f0-9]{64}$/i.test(token)) {
            problema('O link está incompleto. Abra de novo o link que chegou no e-mail.');
            return;
        }
        mostrar('esqueleto');
        try {
            var res = await fetch(api('/auth/me'), { credentials: 'same-origin' });
            var json = await lerJson(res);
            if (!res.ok || !json.user) {
                mostrar('estado-sem-sessao', focar);
                return;
            }
            $('conta-nome').textContent = json.user.nome || '—';
            $('conta-email').textContent = json.user.email || '—';
            mostrar('estado-confirmar', focar);
        } catch {
            problema(
                'Sem conexão com o servidor. Verifique a internet e abra o link de novo.',
                focar
            );
        }
    }

    async function confirmar() {
        var botao = $('btn-confirmar');
        var erro = $('erro-envio');
        botao.disabled = true;
        botao.setAttribute('aria-busy', 'true');
        erro.hidden = true;
        try {
            var res = await fetch(api('/auth/email/confirmar-troca'), {
                method: 'POST',
                credentials: 'same-origin',
                headers: window.csrfHeaders
                    ? window.csrfHeaders(true)
                    : { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: token }),
            });
            var json = await lerJson(res);
            if (res.ok && json.success) {
                // Link usado: sai da barra de endereço e do histórico.
                if (window.history && window.history.replaceState) {
                    window.history.replaceState(null, '', window.location.pathname);
                }
                $('novo-email').textContent = json.email || '';
                if (json.redirect_to && /^\/(?!\/)/.test(json.redirect_to)) {
                    $('link-painel').href = json.redirect_to;
                    $('link-painel').textContent = 'Ir para o painel';
                }
                mostrar('estado-sucesso', true);
                return;
            }
            if (res.status === 401) {
                mostrar('estado-sem-sessao', true);
            } else if (res.status === 400 || res.status === 409) {
                problema(json.error || 'Este link não vale mais.', true);
                return;
            } else {
                erro.textContent = json.error || 'Não foi possível confirmar agora. Tente de novo.';
                erro.hidden = false;
            }
        } catch {
            erro.textContent = 'Sem conexão com o servidor. Tente de novo.';
            erro.hidden = false;
        }
        botao.disabled = false;
        botao.removeAttribute('aria-busy');
    }

    document.addEventListener('DOMContentLoaded', function () {
        $('btn-confirmar').addEventListener('click', confirmar);
        $('btn-tentar-de-novo').addEventListener('click', function () {
            carregarConta(true);
        });
        carregarConta(false);
    });
})();
