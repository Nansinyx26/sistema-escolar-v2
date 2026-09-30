/**
 * voz-sistema.js — preferência de voz nativa, por conta e por navegador.
 *
 * Este módulo não escolhe nem renderiza interface. Ele é a fonte comum para
 * todos os controles de "Voz & Acessibilidade": descobre as vozes que o
 * dispositivo oferece, prioriza pt-BR, guarda uma escolha por conta e expõe a
 * leitura pela Web Speech API. Separar regra de interface evita que Dashboard,
 * Direção, Secretaria e Portal acabem com fallbacks diferentes.
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

    function falar(texto) {
        if (!texto || !sinteseDisponivel()) return false;

        var preferencias = lerPreferencias();
        var utterance = new window.SpeechSynthesisUtterance(String(texto));
        var voz = vozNativa(preferencias);
        if (voz) utterance.voice = voz;
        utterance.rate = preferencias.rate;
        utterance.volume = preferencias.volume;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        return true;
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

    window.VozDoSistema = {
        FRASE_PREVIA: FRASE_PREVIA,
        disponivel: sinteseDisponivel,
        definirConta: definirConta,
        listarVozes: listarVozes,
        preferencias: lerPreferencias,
        salvarPreferencias: gravarPreferencias,
        falar: falar,
        ouvirPrevia: function () {
            return falar(FRASE_PREVIA);
        },
    };
})();
