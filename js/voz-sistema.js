/**
 * voz-sistema.js — preferência de voz nativa, por conta e por navegador.
 *
 * Este módulo não escolhe nem renderiza interface. Ele é a fonte comum para
 * todos os controles de "Voz & Acessibilidade": descobre as vozes que o
 * dispositivo oferece, prioriza pt-BR, guarda uma escolha por conta e expõe a
 * leitura pela Web Speech API. Separar regra de interface evita que Dashboard,
 * Direção, Secretaria e Portal acabem com fallbacks diferentes.
 *
 * EVENTOS DISPARADOS
 * ------------------
 *   'voz-sistema:alterada'          — preferências mudaram (detail.preferencias)
 *   'voz-sistema:vozes-atualizadas' — lista de vozes (re)carregada pelo navegador
 */
(function () {
    'use strict';

    var PREFIXO_CHAVE = 'voz-sistema:v1:';
    var CONTA_ANONIMA = 'anonima';
    var FRASE_PREVIA = 'Olá! Esta é a voz selecionada para o sistema escolar.';
    var contaDefinida = null;
    var memoria = {};

    function numeroEntre(valor, minimo, maximo, padrao) {
        var numero = Number(valor);
        return Number.isFinite(numero) ? Math.min(maximo, Math.max(minimo, numero)) : padrao;
    }

    function contaDaSessao() {
        if (contaDefinida) return contaDefinida;
        try {
            var usuario = window.auth && window.auth.getCurrentUser && window.auth.getCurrentUser();
            var id = usuario && (usuario._id || usuario.id);
            if (id) return String(id);
        } catch (_erro) {
            // A voz continua disponível para telas públicas e durante o login.
        }
        return CONTA_ANONIMA;
    }

    function chaveDaConta() {
        return PREFIXO_CHAVE + contaDaSessao();
    }

    function normalizar(preferencias) {
        preferencias = preferencias && typeof preferencias === 'object' ? preferencias : {};
        return {
            voiceURI: preferencias.voiceURI ? String(preferencias.voiceURI) : null,
            rate: numeroEntre(preferencias.rate, 0.5, 2, 1),
            volume: numeroEntre(preferencias.volume, 0, 1, 1),
        };
    }

    function lerPreferencias() {
        var chave = chaveDaConta();
        if (memoria[chave]) return { ...memoria[chave] };
        try {
            memoria[chave] = normalizar(JSON.parse(localStorage.getItem(chave) || '{}'));
        } catch (_erro) {
            memoria[chave] = normalizar({});
        }
        return { ...memoria[chave] };
    }

    function gravarPreferencias(parcial) {
        var chave = chaveDaConta();
        memoria[chave] = normalizar({ ...lerPreferencias(), ...parcial });
        try {
            localStorage.setItem(chave, JSON.stringify(memoria[chave]));
        } catch (_erro) {
            // Navegação privada ou armazenamento bloqueado: mantém nesta aba.
        }
        window.dispatchEvent(
            new CustomEvent('voz-sistema:alterada', { detail: { preferencias: lerPreferencias() } })
        );
        return lerPreferencias();
    }

    function sinteseDisponivel() {
        return !!(
            window.speechSynthesis &&
            typeof window.speechSynthesis.getVoices === 'function' &&
            typeof window.SpeechSynthesisUtterance === 'function'
        );
    }

    function prioridadeDaLingua(voz) {
        var idioma = String((voz && voz.lang) || '').toLowerCase();
        if (idioma === 'pt-br') return 0;
        if (idioma.indexOf('pt-br') === 0) return 1;
        if (idioma.indexOf('pt') === 0) return 2;
        return 3;
    }

    /**
     * Classifica a voz em uma categoria para apresentação na interface.
     *
     * Não há como detectar gênero com certeza a partir do nome, mas os
     * rótulos mais comuns dos navegadores permitem um palpite útil: nomes
     * como "Google brasileiro", "Microsoft Maria" e similares são
     * reconhecidos pelos padrões abaixo.
     *
     * @param {SpeechSynthesisVoice} voz
     * @returns {'feminina'|'masculina'|'neutra'}
     */
    function classificarVoz(voz) {
        var nome = String(voz.name || '').toLowerCase();
        // Nomes femininos comuns nas engines dos navegadores
        var femininos = [
            'female',
            'mulher',
            'feminina',
            'maria',
            'vitoria',
            'vitória',
            'francisca',
            'alice',
            'google brasileiro',
            'luciana',
            'helena',
            'camila',
            'fernanda',
            'samantha',
            'zira',
            'sabina',
            'monica',
            'raquel',
        ];
        var masculinos = [
            'male',
            'homem',
            'masculin',
            'daniel',
            'ricardo',
            'tiago',
            'thiago',
            'antonio',
            'antônio',
            'pedro',
            'carlos',
            'miguel',
            'david',
            'mark',
        ];

        for (var i = 0; i < femininos.length; i++) {
            if (nome.indexOf(femininos[i]) !== -1) return 'feminina';
        }
        for (var j = 0; j < masculinos.length; j++) {
            if (nome.indexOf(masculinos[j]) !== -1) return 'masculina';
        }
        return 'neutra';
    }

    function listarVozes() {
        if (!sinteseDisponivel()) return [];
        return window.speechSynthesis
            .getVoices()
            .slice()
            .sort(function (a, b) {
                var diferenca = prioridadeDaLingua(a) - prioridadeDaLingua(b);
                if (diferenca) return diferenca;
                return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
            })
            .map(function (voz) {
                return {
                    voiceURI: String(voz.voiceURI || voz.name || ''),
                    nome: String(voz.name || 'Voz do sistema'),
                    idioma: String(voz.lang || ''),
                    padrao: voz.default === true,
                    local: voz.localService !== false,
                    categoria: classificarVoz(voz),
                };
            });
    }

    function vozNativa(preferencias) {
        if (!sinteseDisponivel()) return null;
        var vozes = window.speechSynthesis.getVoices();
        var uri = preferencias && preferencias.voiceURI;
        var escolhida = vozes.find(function (voz) {
            return uri && String(voz.voiceURI || voz.name) === uri;
        });
        if (escolhida) return escolhida;

        return (
            vozes.find(function (voz) {
                return prioridadeDaLingua(voz) < 2;
            }) ||
            vozes.find(function (voz) {
                return prioridadeDaLingua(voz) === 2;
            }) ||
            vozes.find(function (voz) {
                return voz.default === true;
            }) ||
            vozes[0] ||
            null
        );
    }

    /**
     * Fala o texto usando a voz nativa configurada pelo usuário.
     *
     * @param {string} texto — o conteúdo a ser falado
     * @param {object} [opcoes] — opções opcionais
     * @param {number} [opcoes.rate] — sobrescreve a velocidade salva
     * @param {number} [opcoes.volume] — sobrescreve o volume salvo
     * @param {string} [opcoes.voiceURI] — sobrescreve a voz salva
     * @returns {boolean} true se a fala foi iniciada
     */
    function falar(texto, opcoes) {
        if (!texto || !sinteseDisponivel()) return false;

        var preferencias = lerPreferencias();
        var overrides = opcoes && typeof opcoes === 'object' ? opcoes : {};

        var utterance = new window.SpeechSynthesisUtterance(String(texto));
        var prefComOverride = {
            voiceURI: overrides.voiceURI || preferencias.voiceURI,
            rate: overrides.rate || preferencias.rate,
            volume: overrides.volume !== undefined ? overrides.volume : preferencias.volume,
        };
        var voz = vozNativa(prefComOverride);
        if (voz) utterance.voice = voz;
        utterance.rate = prefComOverride.rate;
        utterance.volume = prefComOverride.volume;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        return true;
    }

    /** Para qualquer fala nativa em andamento. */
    function parar() {
        if (sinteseDisponivel()) {
            window.speechSynthesis.cancel();
        }
    }

    function definirConta(id) {
        contaDefinida = id ? String(id) : null;
        return lerPreferencias();
    }

    if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = function () {
            window.dispatchEvent(new CustomEvent('voz-sistema:vozes-atualizadas'));
        };
    }

    // Vincula automaticamente à conta do auth quando ele estiver pronto.
    // `auth:ready` vem de js/auth.js após reconciliar o token.
    window.addEventListener('auth:updated', function () {
        try {
            var usuario = window.auth && window.auth.getCurrentUser && window.auth.getCurrentUser();
            var id = usuario && (usuario._id || usuario.id);
            if (id) definirConta(id);
        } catch (_e) {
            // noop
        }
    });

    window.VozDoSistema = {
        FRASE_PREVIA: FRASE_PREVIA,
        disponivel: sinteseDisponivel,
        definirConta: definirConta,
        listarVozes: listarVozes,
        preferencias: lerPreferencias,
        salvarPreferencias: gravarPreferencias,
        falar: falar,
        parar: parar,
        classificarVoz: classificarVoz,
        ouvirPrevia: function (voiceURI) {
            return falar(FRASE_PREVIA, voiceURI ? { voiceURI: voiceURI } : undefined);
        },
    };
})();
