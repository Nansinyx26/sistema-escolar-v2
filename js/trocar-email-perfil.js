/**
 * trocar-email-perfil.js — "Trocar e-mail" no perfil da equipe (Issue #611).
 *
 * O pedido leva o e-mail novo e a senha atual; o servidor manda o link só para
 * o endereço novo, e a troca só vale quando a pessoa abre o link com esta conta
 * conectada (Issue #609, `html/confirmar-email.html`). Por isso, depois de
 * enviar, o diálogo não diz "e-mail trocado": diz para onde foi o link.
 *
 * Sem `onclick` embutido: o épico de CSP vai tirar o `unsafe-inline`.
 */
(function () {
    'use strict';

    function $(id) {
        return document.getElementById(id);
    }

    function api(caminho) {
        return (window.API_BASE_URL || '/api') + caminho;
    }

    document.addEventListener('DOMContentLoaded', function () {
        var dialogo = $('dialogo-trocar-email');
        var abrir = $('btn-trocar-email');
        if (!dialogo || !abrir || typeof dialogo.showModal !== 'function') return;

        var form = $('form-trocar-email');
        var enviado = $('te-enviado');
        var erro = $('te-erro');
        var campoEmail = $('te-novo-email');
        var campoSenha = $('te-senha');
        var botao = $('te-enviar');

        function mostrarErro(mensagem) {
            erro.textContent = mensagem;
            erro.hidden = false;
        }

        function reiniciar() {
            form.reset();
            form.hidden = false;
            enviado.hidden = true;
            erro.hidden = true;
            botao.disabled = false;
            botao.removeAttribute('aria-busy');
        }

        abrir.addEventListener('click', function () {
            reiniciar();
            dialogo.showModal();
            campoEmail.focus();
        });

        // Fechar descarta o que foi digitado: a senha não fica no campo.
        dialogo.addEventListener('close', reiniciar);

        dialogo.addEventListener('click', function (e) {
            // Clique no fundo: o alvo é o próprio <dialog>, fora do conteúdo.
            if (e.target === dialogo || e.target.closest('[data-te-fechar]')) dialogo.close();
        });

        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            var novoEmail = campoEmail.value.trim();
            var senhaAtual = campoSenha.value;
            erro.hidden = true;
            if (!novoEmail || !senhaAtual) {
                mostrarErro('Preencha o e-mail novo e a sua senha atual.');
                return;
            }

            botao.disabled = true;
            botao.setAttribute('aria-busy', 'true');
            try {
                var res = await fetch(api('/auth/email/solicitar-troca'), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: window.csrfHeaders
                        ? window.csrfHeaders(true)
                        : { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ novoEmail: novoEmail, senhaAtual: senhaAtual }),
                });
                var json = {};
                try {
                    json = await res.json();
                } catch {
                    json = {};
                }
                if (res.ok && json.success) {
                    campoSenha.value = '';
                    $('te-endereco').textContent = novoEmail;
                    form.hidden = true;
                    enviado.hidden = false;
                    enviado.querySelector('button').focus();
                    return;
                }
                mostrarErro(json.error || 'Não foi possível enviar agora. Tente de novo.');
            } catch {
                mostrarErro('Sem conexão com o servidor. Tente de novo.');
            }
            botao.disabled = false;
            botao.removeAttribute('aria-busy');
        });
    });
})();
