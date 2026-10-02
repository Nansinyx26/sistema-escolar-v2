/**
 * modal-voz.js — modal "Voz e Acessibilidade" dos painéis (Issue #564).
 *
 * Um lugar só, em qualquer conta da equipe, para trocar a voz:
 *
 *   - Narrador do sistema: as vozes do provedor (`window.Vozes`, em
 *     js/sidebar-voice.js), separadas em Femininas e Masculinas. Escolher toca
 *     a prévia e grava no navegador e no servidor — é o mesmo `Vozes.definir`
 *     que a gaveta, o chatbot e a barra lateral usam.
 *   - Voz do dispositivo: as vozes da Web Speech API (`window.VozDoSistema`,
 *     em js/voz-sistema.js), com filtro por gênero, velocidade, volume e
 *     prévia. A preferência é por conta.
 *   - Modo de leitura: texto, texto + áudio ou só áudio.
 *
 * Este arquivo só monta interface. Regra de voz mora nos dois módulos acima;
 * se um deles faltar na página, a seção correspondente simplesmente não
 * aparece, e o resto do modal continua funcionando.
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

    var FILTROS_DISPOSITIVO = [{ chave: 'todas', rotulo: 'Todas' }].concat(GENEROS);

    var MODOS = [
        { chave: 'texto_audio', rotulo: 'Texto + áudio' },
        { chave: 'texto', rotulo: 'Só texto' },
        { chave: 'audio', rotulo: 'Só áudio' },
    ];

    var dialogo = null;
    var ultimoFoco = null;
    var abaNarrador = null;
    var filtroDispositivo = 'todas';

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

    function temVozDoDispositivo() {
        return !!(window.VozDoSistema && window.VozDoSistema.disponivel());
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
            '<section class="mv-secao" id="mv-secao-dispositivo" aria-labelledby="mv-dispositivo-titulo">' +
            '<div class="mv-secao-topo">' +
            '<h3 class="mv-secao-titulo" id="mv-dispositivo-titulo">Voz do dispositivo</h3>' +
            '<div id="mv-filtros-dispositivo"></div>' +
            '</div>' +
            '<p class="mv-ajuda">Usada nas leituras de acessibilidade. Funciona sem internet; as vozes dependem do navegador.</p>' +
            '<div class="mv-campo">' +
            '<label for="mv-voz-dispositivo">Voz</label>' +
            '<div class="mv-linha">' +
            '<select id="mv-voz-dispositivo" class="mv-select"></select>' +
            '<button type="button" class="mv-botao" id="mv-previa-dispositivo"><i class="bi bi-play-fill" aria-hidden="true"></i> Ouvir</button>' +
            '</div>' +
            '<p class="mv-aviso" id="mv-aviso-dispositivo" hidden></p>' +
            '</div>' +
            '<div class="mv-grade">' +
            '<div class="mv-campo">' +
            '<label for="mv-velocidade">Velocidade <output id="mv-velocidade-valor" for="mv-velocidade">1.0x</output></label>' +
            '<input type="range" id="mv-velocidade" class="mv-range" min="0.5" max="2" step="0.1" value="1">' +
            '</div>' +
            '<div class="mv-campo">' +
            '<label for="mv-volume">Volume <output id="mv-volume-valor" for="mv-volume">100%</output></label>' +
            '<input type="range" id="mv-volume" class="mv-range" min="0" max="1" step="0.05" value="1">' +
            '</div>' +
            '</div>' +
            '</section>' +
            '<section class="mv-secao" aria-labelledby="mv-modo-titulo">' +
            '<div class="mv-secao-topo">' +
            '<h3 class="mv-secao-titulo" id="mv-modo-titulo">Modo de leitura</h3>' +
            '</div>' +
            '<div id="mv-modos"></div>' +
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

    // ---------- Voz do dispositivo ----------
    function renderizarDispositivo() {
        var secao = dialogo.querySelector('#mv-secao-dispositivo');
        if (!temVozDoDispositivo()) {
            secao.hidden = true;
            return;
        }
        secao.hidden = false;

        dialogo.querySelector('#mv-filtros-dispositivo').innerHTML = segmentos(
            'mv-filtro',
            'Filtrar vozes do dispositivo',
            FILTROS_DISPOSITIVO,
            filtroDispositivo
        );

        var prefs = window.VozDoSistema.preferencias();
        var vozes = window.VozDoSistema.listarVozes();
        var visiveis = vozes.filter(function (v) {
            return filtroDispositivo === 'todas' || v.categoria === filtroDispositivo;
        });

        var html = '<option value="">Padrão do sistema (pt-BR)</option>';
        var grupos =
            filtroDispositivo === 'todas'
                ? GENEROS.concat([{ chave: 'neutra', rotulo: 'Outras vozes' }])
                : GENEROS.filter(function (g) {
                      return g.chave === filtroDispositivo;
                  });
        grupos.forEach(function (g) {
            var lista = visiveis.filter(function (v) {
                return (v.categoria || 'neutra') === g.chave;
            });
            if (!lista.length) return;
            html += '<optgroup label="' + escapar(g.rotulo) + '">';
            lista.forEach(function (v) {
                html +=
                    '<option value="' +
                    escapar(v.voiceURI) +
                    '">' +
                    escapar(v.nome) +
                    (v.idioma ? ' (' + escapar(v.idioma) + ')' : '') +
                    '</option>';
            });
            html += '</optgroup>';
        });

        var select = dialogo.querySelector('#mv-voz-dispositivo');
        select.innerHTML = html;
        var salvaVisivel = visiveis.some(function (v) {
            return v.voiceURI === prefs.voiceURI;
        });
        // A voz salva fora do filtro continua salva; o select só não a mostra.
        select.value = salvaVisivel ? prefs.voiceURI : '';

        var aviso = dialogo.querySelector('#mv-aviso-dispositivo');
        if (filtroDispositivo !== 'todas' && !visiveis.length) {
            aviso.textContent =
                'Este navegador não oferece vozes ' +
                (filtroDispositivo === 'feminina' ? 'femininas' : 'masculinas') +
                ' reconhecíveis. As do narrador do sistema funcionam em qualquer aparelho.';
            aviso.hidden = false;
        } else {
            aviso.hidden = true;
        }

        var velocidade = dialogo.querySelector('#mv-velocidade');
        var volume = dialogo.querySelector('#mv-volume');
        velocidade.value = prefs.rate;
        volume.value = prefs.volume;
        dialogo.querySelector('#mv-velocidade-valor').textContent =
            Number(prefs.rate).toFixed(1) + 'x';
        dialogo.querySelector('#mv-volume-valor').textContent =
            Math.round(Number(prefs.volume) * 100) + '%';
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
        renderizarDispositivo();
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
            } else if (alvo.dataset.mvFiltro) {
                filtroDispositivo = alvo.dataset.mvFiltro;
                renderizarDispositivo();
                focarNoGrupo('[data-mv-filtro="' + filtroDispositivo + '"]');
            } else if (alvo.dataset.mvModo) {
                definirModo(alvo.dataset.mvModo);
                focarNoGrupo('[data-mv-modo="' + alvo.dataset.mvModo + '"]');
            } else if (alvo.id === 'mv-previa-dispositivo') {
                var uri = dialogo.querySelector('#mv-voz-dispositivo').value || null;
                window.VozDoSistema.ouvirPrevia(uri);
            }
        });

        dialogo.querySelector('#mv-voz-dispositivo').addEventListener('change', function (e) {
            var uri = e.target.value || null;
            window.VozDoSistema.salvarPreferencias({ voiceURI: uri });
            window.VozDoSistema.ouvirPrevia(uri);
        });

        dialogo.querySelector('#mv-velocidade').addEventListener('input', function (e) {
            var v = Number(e.target.value);
            dialogo.querySelector('#mv-velocidade-valor').textContent = v.toFixed(1) + 'x';
            window.VozDoSistema.salvarPreferencias({ rate: v });
        });

        dialogo.querySelector('#mv-volume').addEventListener('input', function (e) {
            var v = Number(e.target.value);
            dialogo.querySelector('#mv-volume-valor').textContent = Math.round(v * 100) + '%';
            window.VozDoSistema.salvarPreferencias({ volume: v });
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

        // A lista de vozes do dispositivo chega depois em Chrome/Edge, e a voz
        // pode ser trocada em outra tela com o modal aberto.
        window.addEventListener('voz-sistema:vozes-atualizadas', function () {
            if (estaAberto()) renderizarDispositivo();
        });
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
            dialogo.querySelectorAll('button, select, input, [tabindex]:not([tabindex="-1"])'),
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
