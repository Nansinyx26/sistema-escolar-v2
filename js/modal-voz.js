/**
 * modal-voz.js — modal "Voz e Acessibilidade" dos painéis (Issue #564).
 *
 * Um lugar só, em qualquer conta da equipe, para trocar a voz:
 *
 *   - Narrador do sistema: as vozes do provedor (`window.Vozes`, em
 *     js/sidebar-voice.js), separadas em Femininas e Masculinas. Escolher toca
 *     a prévia e grava no navegador e no servidor — é o mesmo `Vozes.definir`
 *     que a gaveta, o chatbot e a barra lateral usam.
 *   - Modo de leitura: texto, texto + áudio ou só áudio.
 *
 * Só vozes do narrador do servidor: a voz sintetizada pelo navegador fica de
 * fora de propósito — muda de aparelho para aparelho e soa pior que a do
 * provedor. Este arquivo só monta interface; a regra de voz mora no catálogo.
 *
 * Abre por qualquer elemento com `data-abrir-modal-voz` ou por
 * `window.ModalVoz.abrir()`.
 */
(function () {
    'use strict';

    var GENEROS = [
        { chave: 'feminina', rotulo: 'Femininas' },
        { chave: 'masculina', rotulo: 'Masculinas' },
    ];

    var MODOS = [
        { chave: 'texto_audio', rotulo: 'Texto + áudio' },
        { chave: 'texto', rotulo: 'Só texto' },
        { chave: 'audio', rotulo: 'Só áudio' },
    ];

    var dialogo = null;
    var ultimoFoco = null;
    var abaNarrador = null;

    function ler(chave, alternativa) {
        try {
            var v = localStorage.getItem(chave);
            return v === null ? alternativa : v;
        } catch (_e) {
            return alternativa;
        }
    }

    function gravar(chave, valor) {
        try {
            localStorage.setItem(chave, String(valor));
        } catch (_e) {
            /* armazenamento bloqueado — vale só nesta aba */
        }
    }

    function escapar(texto) {
        return String(texto).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function temNarrador() {
        return !!(window.Vozes && window.Vozes.LISTA);
    }

    function movimentoReduzido() {
        return (
            document.documentElement.classList.contains('reduce-motion') ||
            (typeof window.matchMedia === 'function' &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        );
    }

    /** Grupo de botões alternáveis (aria-pressed) — usado por abas e filtros. */
    function segmentos(nome, rotuloGrupo, opcoes, ativa) {
        return (
            '<div class="mv-segmentos" role="group" aria-label="' +
            escapar(rotuloGrupo) +
            '">' +
            opcoes
                .map(function (o) {
                    return (
                        '<button type="button" class="mv-segmento" data-' +
                        nome +
                        '="' +
                        o.chave +
                        '" aria-pressed="' +
                        (o.chave === ativa) +
                        '">' +
                        escapar(o.rotulo) +
                        '</button>'
                    );
                })
                .join('') +
            '</div>'
        );
    }

    function montar() {
        dialogo = document.createElement('dialog');
        dialogo.id = 'modal-voz';
        dialogo.className = 'mv-dialogo';
        dialogo.setAttribute('aria-labelledby', 'mv-titulo');
        dialogo.setAttribute('aria-describedby', 'mv-descricao');
        dialogo.innerHTML =
            '<div class="mv-cabecalho">' +
            '<div>' +
            '<h2 class="mv-titulo" id="mv-titulo"><i class="bi bi-soundwave" aria-hidden="true"></i> Voz e Acessibilidade</h2>' +
            '<p class="mv-descricao" id="mv-descricao">Escolha como o sistema fala com você. Vale só para a sua conta.</p>' +
            '</div>' +
            '<button type="button" class="mv-fechar" data-mv-fechar aria-label="Fechar"><i class="bi bi-x-lg" aria-hidden="true"></i></button>' +
            '</div>' +
            '<section class="mv-secao" id="mv-secao-narrador" aria-labelledby="mv-narrador-titulo">' +
            '<div class="mv-secao-topo">' +
            '<h3 class="mv-secao-titulo" id="mv-narrador-titulo">Narrador do sistema</h3>' +
            '<div id="mv-abas-narrador"></div>' +
            '</div>' +
            '<p class="mv-ajuda">Narra avisos, o assistente e o chatbot. Toque numa voz para ouvir e usar.</p>' +
            '<div class="mv-vozes" id="mv-vozes" role="group" aria-label="Vozes do narrador"></div>' +
            '</section>' +
            '<section class="mv-secao" aria-labelledby="mv-modo-titulo">' +
            '<div class="mv-secao-topo">' +
            '<h3 class="mv-secao-titulo" id="mv-modo-titulo">Modo de leitura</h3>' +
            '</div>' +
            '<div id="mv-modos" class="mv-modos"></div>' +
            '</section>';

        document.body.appendChild(dialogo);
        ligarEventos();
    }

    // ---------- Narrador ----------
    function renderizarNarrador() {
        var secao = dialogo.querySelector('#mv-secao-narrador');
        if (!temNarrador()) {
            secao.hidden = true;
            return;
        }
        secao.hidden = false;
        var atual = window.Vozes.atual();
        if (!abaNarrador) abaNarrador = window.Vozes.porNome(atual).genero || 'feminina';

        dialogo.querySelector('#mv-abas-narrador').innerHTML = segmentos(
            'mv-aba',
            'Gênero da voz do narrador',
            GENEROS,
            abaNarrador
        );

        dialogo.querySelector('#mv-vozes').innerHTML = window.Vozes.LISTA.filter(function (v) {
            return v.genero === abaNarrador;
        })
            .map(function (v) {
                var ativa = v.nome === atual;
                return (
                    '<button type="button" class="mv-voz" data-mv-voz="' +
                    v.nome +
                    '" aria-pressed="' +
                    ativa +
                    '">' +
                    '<span class="mv-voz-nome">' +
                    escapar(v.rotulo) +
                    (ativa ? ' <span class="mv-selo">Em uso</span>' : '') +
                    '</span>' +
                    '<span class="mv-voz-desc">' +
                    escapar(v.descricao) +
                    '</span>' +
                    '</button>'
                );
            })
            .join('');
    }

    // ---------- Modo de leitura ----------
    function renderizarModos() {
        dialogo.querySelector('#mv-modos').innerHTML = segmentos(
            'mv-modo',
            'Modo de leitura',
            MODOS,
            ler('user_narration_mode', 'texto_audio')
        );
    }

    function definirModo(modo) {
        gravar('user_narration_mode', modo);
        gravar('user_preferencia_narracao', modo);
        document.body.classList.remove(
            'preference-texto',
            'preference-texto-audio',
            'preference-audio'
        );
        document.body.classList.add('preference-' + modo.replace('_', '-'));
        var legado = document.getElementById('voice-mode-select');
        if (legado) legado.value = modo;
        window.dispatchEvent(new CustomEvent('narrationModeChanged', { detail: modo }));
        if (typeof window.saveAccessibilityPreference === 'function') {
            window.saveAccessibilityPreference({ narrationMode: modo });
        }
        renderizarModos();
    }

    function renderizar() {
        renderizarNarrador();
        renderizarModos();
    }

    function ligarEventos() {
        dialogo.addEventListener('click', function (e) {
            // Clique no fundo: o alvo é o próprio <dialog>, fora do conteúdo.
            if (e.target === dialogo) {
                fechar();
                return;
            }
            var alvo = e.target.closest('button');
            if (!alvo || !dialogo.contains(alvo)) return;

            if (alvo.hasAttribute('data-mv-fechar')) {
                fechar();
            } else if (alvo.dataset.mvAba) {
                abaNarrador = alvo.dataset.mvAba;
                renderizarNarrador();
                focarNoGrupo('[data-mv-aba="' + abaNarrador + '"]');
            } else if (alvo.dataset.mvVoz) {
                window.Vozes.definir(alvo.dataset.mvVoz, { previa: true });
                renderizarNarrador();
                focarNoGrupo('[data-mv-voz="' + alvo.dataset.mvVoz + '"]');
            } else if (alvo.dataset.mvModo) {
                definirModo(alvo.dataset.mvModo);
                focarNoGrupo('[data-mv-modo="' + alvo.dataset.mvModo + '"]');
            }
        });

        // Esc: o navegador dispara `cancel`; fechamos pelo mesmo caminho para
        // ter a saída suave e devolver o foco.
        dialogo.addEventListener('cancel', function (e) {
            e.preventDefault();
            fechar();
        });

        // Navegador sem <dialog> modal (ou jsdom): Esc e foco preso à mão.
        dialogo.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && typeof dialogo.showModal !== 'function') {
                e.preventDefault();
                fechar();
            }
            if (e.key === 'Tab') prenderFoco(e);
        });

        // A voz pode ser trocada em outra tela (chatbot) com o modal aberto.
        window.addEventListener('voiceChanged', function () {
            if (estaAberto()) renderizarNarrador();
        });
    }

    /** Re-renderizar troca os botões; devolve o foco ao equivalente novo. */
    function focarNoGrupo(seletor) {
        var el = dialogo.querySelector(seletor);
        if (el) el.focus();
    }

    function focaveis() {
        return Array.prototype.filter.call(
            dialogo.querySelectorAll('button, [tabindex]:not([tabindex="-1"])'),
            function (el) {
                return !el.disabled && !el.closest('[hidden]');
            }
        );
    }

    function prenderFoco(e) {
        var lista = focaveis();
        if (!lista.length) return;
        var primeiro = lista[0];
        var ultimo = lista[lista.length - 1];
        if (e.shiftKey && document.activeElement === primeiro) {
            e.preventDefault();
            ultimo.focus();
        } else if (!e.shiftKey && document.activeElement === ultimo) {
            e.preventDefault();
            primeiro.focus();
        }
    }

    function estaAberto() {
        return !!(dialogo && dialogo.open);
    }

    function abrir() {
        if (!dialogo) montar();
        if (estaAberto()) return;
        ultimoFoco = document.activeElement;
        abaNarrador = null; // reabre na aba da voz em uso
        renderizar();
        dialogo.classList.remove('mv-saindo');
        if (typeof dialogo.showModal === 'function') dialogo.showModal();
        else dialogo.setAttribute('open', '');
        if (window.ScrollLock) window.ScrollLock.lock('modal-voz');
        var foco = dialogo.querySelector('.mv-voz[aria-pressed="true"]') || focaveis()[0];
        if (foco) foco.focus();
    }

    function concluirFechamento() {
        dialogo.classList.remove('mv-saindo');
        if (typeof dialogo.close === 'function') dialogo.close();
        else dialogo.removeAttribute('open');
        if (window.ScrollLock) window.ScrollLock.unlock('modal-voz');
        if (ultimoFoco && typeof ultimoFoco.focus === 'function') ultimoFoco.focus();
        ultimoFoco = null;
    }

    function fechar() {
        if (!estaAberto() || dialogo.classList.contains('mv-saindo')) return;
        if (movimentoReduzido()) {
            concluirFechamento();
            return;
        }
        // Saída mais curta que a entrada (docs/MOTION.md). O timeout garante o
        // fechamento se `animationend` não vier (aba em segundo plano).
        dialogo.classList.add('mv-saindo');
        var feito = false;
        function terminar() {
            if (feito) return;
            feito = true;
            dialogo.removeEventListener('animationend', terminar);
            concluirFechamento();
        }
        dialogo.addEventListener('animationend', terminar);
        setTimeout(terminar, 220);
    }

    document.addEventListener('click', function (e) {
        var gatilho = e.target.closest && e.target.closest('[data-abrir-modal-voz]');
        if (!gatilho) return;
        e.preventDefault();
        abrir();
    });

    window.ModalVoz = { abrir: abrir, fechar: fechar, estaAberto: estaAberto };
})();
