/**
 * js/filtro-palavroes-ui.js — camada visual do filtro de linguagem.
 *
 * Depende de `js/filtro-palavroes.js` (carregue-o ANTES deste arquivo).
 *
 * Aqui só existe experiência de uso: avisar enquanto a pessoa digita e travar
 * o botão de enviar. A regra que VALE é a do servidor
 * (backend/src/middleware/bloquearPalavroes.js) — este arquivo pode ser
 * desabilitado no navegador sem que o palavrão consiga ser publicado.
 *
 * Duas formas de usar:
 *
 * 1. Declarativa — marque o campo no HTML e pronto:
 *        <textarea data-filtro-palavroes data-filtro-botao="#enviar"></textarea>
 *
 * 2. Programática — para campos criados em JavaScript (React, templates):
 *        FiltroPalavroesUI.proteger(elemento, { botao: btn });
 *        if (!FiltroPalavroesUI.validarAntesDeEnviar(texto)) return;
 */
(function (window, document) {
    'use strict';

    const filtro = window.FiltroPalavroes;

    if (!filtro) {
        console.error('[FiltroPalavroesUI] js/filtro-palavroes.js precisa ser carregado antes.');
        return;
    }

    const CLASSE_CAMPO_INVALIDO = 'campo-linguagem-impropria';
    const CLASSE_AVISO = 'aviso-linguagem-impropria';

    injetarEstilos();

    // ─────────────────────────────────────────────────────────────────────
    // Aviso
    // ─────────────────────────────────────────────────────────────────────

    /**
     * O aviso é criado como irmão imediato do campo e reaproveitado nas
     * digitações seguintes — recriar o nó a cada tecla faria o leitor de tela
     * reanunciar o texto inteiro sem parar.
     */
    function obterAviso(campo) {
        if (campo._avisoLinguagem && campo._avisoLinguagem.isConnected) {
            return campo._avisoLinguagem;
        }
        const aviso = document.createElement('div');
        aviso.className = CLASSE_AVISO;
        aviso.setAttribute('role', 'alert');
        aviso.setAttribute('aria-live', 'polite');
        aviso.hidden = true;
        if (campo.parentNode) {
            campo.parentNode.insertBefore(aviso, campo.nextSibling);
        }
        campo._avisoLinguagem = aviso;
        return aviso;
    }

    function mostrarAviso(campo, resultado) {
        const aviso = obterAviso(campo);
        aviso.hidden = false;
        aviso.dataset.nivel = resultado.nivel;
        aviso.textContent = (resultado.bloquear ? '🚫 ' : '⚠️ ') + resultado.mensagem;
        campo.classList.add(CLASSE_CAMPO_INVALIDO);
        campo.setAttribute('aria-invalid', 'true');
    }

    function limparAviso(campo) {
        if (campo._avisoLinguagem) {
            campo._avisoLinguagem.hidden = true;
            campo._avisoLinguagem.textContent = '';
        }
        campo.classList.remove(CLASSE_CAMPO_INVALIDO);
        campo.removeAttribute('aria-invalid');
    }

    // ─────────────────────────────────────────────────────────────────────
    // API
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Vigia um campo de texto.
     *
     * @param {HTMLElement} campo
     * @param {Object} [opcoes]
     * @param {HTMLElement|string} [opcoes.botao] botão a desabilitar enquanto houver palavrão
     * @param {Function} [opcoes.aoMudar] callback `(resultado) => void`
     * @returns {Function} desfaz a proteção (remova junto com o campo)
     */
    function proteger(campo, opcoes) {
        if (!campo || campo._filtroProtegido) return function () {};
        const config = opcoes || {};
        const botao = typeof config.botao === 'string'
            ? document.querySelector(config.botao)
            : config.botao;

        const verificar = () => {
            const resultado = filtro.analisar(campo.value || '');
            if (resultado.limpo) {
                limparAviso(campo);
            } else {
                mostrarAviso(campo, resultado);
            }
            if (botao) {
                botao.disabled = resultado.bloquear;
                botao.classList.toggle('bloqueado-por-linguagem', resultado.bloquear);
                if (resultado.bloquear) {
                    botao.title = resultado.mensagem;
                } else if (botao.title === resultado.mensagem) {
                    botao.removeAttribute('title');
                }
            }
            if (typeof config.aoMudar === 'function') config.aoMudar(resultado);
            return resultado;
        };

        // `input` cobre digitação, colagem e ditado por voz de uma vez só.
        campo.addEventListener('input', verificar);
        campo.addEventListener('blur', verificar);
        campo._filtroProtegido = true;

        return function desproteger() {
            campo.removeEventListener('input', verificar);
            campo.removeEventListener('blur', verificar);
            campo._filtroProtegido = false;
            limparAviso(campo);
        };
    }

    /**
     * Checagem no momento do envio, para fluxos sem campo vigiado (envio por
     * Enter, formulário montado na hora, resposta a comentário).
     *
     * @returns {boolean} `true` se o texto pode ser enviado.
     */
    function validarAntesDeEnviar(texto, opcoes) {
        const config = opcoes || {};
        const resultado = filtro.analisar(texto);
        if (!resultado.bloquear) return true;
        notificar(resultado.mensagem);
        if (config.campo) mostrarAviso(config.campo, resultado);
        return false;
    }

    /** Usa o toast do sistema quando existe; senão, um toast próprio. */
    function notificar(mensagem) {
        if (typeof window.showToast === 'function') {
            window.showToast(mensagem, 'error');
            return;
        }
        const toast = document.createElement('div');
        toast.className = 'toast-linguagem-impropria';
        toast.setAttribute('role', 'alert');
        toast.textContent = '🚫 ' + mensagem;
        document.body.appendChild(toast);
        setTimeout(function () { toast.remove(); }, 4000);
    }

    /** Protege tudo que estiver marcado com `data-filtro-palavroes`. */
    function protegerMarcados(raiz) {
        (raiz || document).querySelectorAll('[data-filtro-palavroes]').forEach(function (campo) {
            proteger(campo, { botao: campo.dataset.filtroBotao || null });
        });
    }

    /**
     * Barra o submit de um formulário cujos campos tenham palavrão — última
     * rede antes do fetch, para formulários que não passam por `proteger`.
     */
    function protegerFormulario(form, campos) {
        if (!form) return;
        form.addEventListener('submit', function (evento) {
            const lista = campos && campos.length
                ? campos.map(function (sel) { return form.querySelector(sel); })
                : Array.from(form.querySelectorAll('input[type="text"], textarea'));

            for (const campo of lista) {
                if (!campo || typeof campo.value !== 'string') continue;
                if (!validarAntesDeEnviar(campo.value, { campo })) {
                    evento.preventDefault();
                    evento.stopPropagation();
                    campo.focus();
                    return;
                }
            }
        }, true);
    }

    function injetarEstilos() {
        if (document.getElementById('estilos-filtro-palavroes')) return;
        const estilo = document.createElement('style');
        estilo.id = 'estilos-filtro-palavroes';
        estilo.textContent = [
            '.' + CLASSE_AVISO + '{',
            '  display:flex;align-items:center;gap:6px;',
            '  margin:6px 0 2px;padding:8px 10px;border-radius:8px;',
            '  font-size:.8rem;line-height:1.35;font-weight:500;',
            '  background:rgba(220,38,38,.10);color:#b91c1c;',
            '  border:1px solid rgba(220,38,38,.30);',
            '}',
            '.' + CLASSE_AVISO + '[data-nivel="leve"]{',
            '  background:rgba(217,119,6,.10);color:#b45309;',
            '  border-color:rgba(217,119,6,.30);',
            '}',
            '.' + CLASSE_CAMPO_INVALIDO + '{',
            '  border-color:#dc2626 !important;',
            '  box-shadow:0 0 0 2px rgba(220,38,38,.18) !important;',
            '}',
            '.bloqueado-por-linguagem{opacity:.5;cursor:not-allowed;}',
            '.toast-linguagem-impropria{',
            '  position:fixed;left:50%;bottom:24px;transform:translateX(-50%);',
            '  z-index:99999;max-width:min(92vw,420px);',
            '  padding:12px 16px;border-radius:10px;',
            '  background:#b91c1c;color:#fff;font-size:.85rem;font-weight:600;',
            '  box-shadow:0 8px 24px rgba(0,0,0,.25);',
            '}',
            '@media (prefers-color-scheme: dark){',
            '  .' + CLASSE_AVISO + '{background:rgba(248,113,113,.12);color:#fca5a5;}',
            '  .' + CLASSE_AVISO + '[data-nivel="leve"]{background:rgba(251,191,36,.12);color:#fcd34d;}',
            '}'
        ].join('\n');
        document.head.appendChild(estilo);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { protegerMarcados(); });
    } else {
        protegerMarcados();
    }

    window.FiltroPalavroesUI = {
        proteger,
        protegerMarcados,
        protegerFormulario,
        validarAntesDeEnviar,
        notificar,
        analisar: filtro.analisar,
        censurar: filtro.censurar
    };
}(window, document));
