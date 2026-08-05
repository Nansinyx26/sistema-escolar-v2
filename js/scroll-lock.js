/**
 * scroll-lock.js
 * Trava de rolagem única e compartilhada do Sistema Escolar.
 *
 * Substitui quatro implementações independentes que se atropelavam:
 *   - js/sidebar-voice.js          (classe + position:fixed)
 *   - js/settings-drawer.js        (body.style.overflow)
 *   - js/secretaria-codigo-aluno.js(documentElement.style.overflow)
 *   - direcao/direcao-notificacoes.js (body.style.overflow)
 *
 * Dois problemas que isso causava:
 *   1. `overflow: hidden` no body NÃO trava a rolagem no iOS Safari — a
 *      página continuava deslizando por trás do modal.
 *   2. Sem contagem de referências, abrir o menu e depois um modal e fechar
 *      só o modal destravava o body com o menu ainda aberto — e, pior,
 *      limpava o `top` salvo pelo menu, jogando o usuário para o topo.
 *
 * Esta versão usa contagem de referências por dono (owner) e restaura a
 * posição de rolagem exata ao destravar.
 *
 * Uso:
 *   ScrollLock.lock('meu-modal');
 *   ScrollLock.unlock('meu-modal');
 *   ScrollLock.isLocked();
 */
(function (window, document) {
    'use strict';

    var owners = [];
    var savedY = 0;

    var root = document.documentElement;

    function apply() {
        savedY = window.scrollY || window.pageYOffset || 0;
        // A CSS em mobile-scroll.css lê esta variável para posicionar o body.
        root.style.setProperty('--scroll-lock-top', '-' + savedY + 'px');
        root.classList.add('scroll-locked');
    }

    function release() {
        root.classList.remove('scroll-locked');
        root.style.removeProperty('--scroll-lock-top');
        // 'instant' evita que o scroll-behavior:smooth anime o retorno,
        // o que apareceria como um salto lento após fechar o modal.
        try {
            window.scrollTo({ top: savedY, left: 0, behavior: 'instant' });
        } catch (e) {
            window.scrollTo(0, savedY);
        }
    }

    var ScrollLock = {
        /**
         * Trava a rolagem da página. Idempotente por dono: chamar duas vezes
         * com o mesmo `owner` conta como uma.
         * @param {string} owner identificador de quem pediu a trava
         */
        lock: function (owner) {
            var id = owner || 'anonimo';
            if (owners.indexOf(id) !== -1) return;
            if (owners.length === 0) apply();
            owners.push(id);
        },

        /**
         * Libera a trava deste dono. A página só volta a rolar quando o
         * último dono liberar.
         * @param {string} owner mesmo identificador usado no lock
         */
        unlock: function (owner) {
            var id = owner || 'anonimo';
            var i = owners.indexOf(id);
            if (i === -1) return;
            owners.splice(i, 1);
            if (owners.length === 0) release();
        },

        /** Libera tudo — use só em troca de página / estado inconsistente. */
        clear: function () {
            if (owners.length === 0) return;
            owners = [];
            release();
        },

        isLocked: function () {
            return owners.length > 0;
        },

        /** Quem está segurando a trava (diagnóstico). */
        owners: function () {
            return owners.slice();
        }
    };

    // Rede de segurança: se um modal for removido do DOM sem chamar unlock,
    // a página ficaria travada para sempre. Ao voltar/avançar no histórico
    // ou restaurar do bfcache, destrava.
    window.addEventListener('pageshow', function (e) {
        if (e.persisted) ScrollLock.clear();
    });

    window.ScrollLock = ScrollLock;
})(window, document);
