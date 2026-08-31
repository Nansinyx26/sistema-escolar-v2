/**
 * diagnostico-gemini.js — Issue #155
 *
 * Consome `GET /api/ia/gemini-status` (diretor/admin) pela tela de diagnóstico.
 *
 * O ponto do arquivo é o VEREDITO, não o fetch. Quatro respostas diferentes
 * pedem quatro ações diferentes de quem lê, e duas delas são fáceis de
 * confundir:
 *
 *   cota esgotada  -> a chave está CERTA. Trocar a chave não resolve e joga
 *                     fora uma chave boa.
 *   chave recusada -> a chave está ERRADA. Aí sim, gerar outra.
 *
 * O endpoint distingue os dois casos (`quotaExceeded`), mas até agora nenhuma
 * tela lia isso. Confundir os dois é o erro de leitura mais caro desta página.
 *
 * O outro cuidado é o que NÃO é veredito: 401, 403 e falha de rede não provam
 * nada sobre a chave. Marcá-los como "chave inválida" mandaria alguém trocar
 * uma chave por causa de uma sessão expirada.
 */
(function () {
    'use strict';

    /**
     * Traduz a resposta do endpoint em um veredito.
     *
     * Pura de propósito: não toca no DOM, não faz rede, não lê `window`. É o
     * que torna cada ramo testável sem navegador.
     *
     * @param {{status?: number, corpo?: object|null, erroDeRede?: boolean,
     *          motivo?: string}} resposta
     * @returns {{estado: string, rotulo: string, tom: string, titulo: string,
     *            acao: string, detalhe: string}}
     */
    function vereditoGemini(resposta) {
        const r = resposta || {};

        // Nada foi provado sobre a chave — o veredito fica indeterminado.
        if (r.erroDeRede) {
            return indeterminado(
                'Não deu para falar com o servidor',
                'A requisição não chegou ao backend, então nada foi verificado sobre a chave. ' +
                    'Confira se a API está no ar no card "Status da API" e tente de novo.'
            );
        }
        if (r.status === 401) {
            return indeterminado(
                'Sessão expirada',
                'Sua sessão caiu antes do teste. Entre de novo e repita — nada foi verificado ' +
                    'sobre a chave.'
            );
        }
        if (r.status === 403) {
            return indeterminado(
                'Sem permissão para testar',
                'O teste é restrito a diretor e admin. Nada foi verificado sobre a chave.'
            );
        }
        if (r.status !== 200 || !r.corpo || r.corpo.success === false) {
            return indeterminado(
                'Resposta inesperada do servidor',
                'O backend respondeu algo que esta tela não sabe ler' +
                    (r.status ? ` (HTTP ${r.status})` : '') +
                    '. Nada foi verificado sobre a chave.'
            );
        }

        const corpo = r.corpo;

        if (corpo.keyConfigured === false) {
            return {
                estado: 'ausente',
                rotulo: 'Sem chave',
                tom: 'erro',
                titulo: 'Nenhuma variável de chave publicada',
                acao:
                    'Publique GEMINI_KEY nas variáveis de ambiente do Render e REFAÇA O DEPLOY — ' +
                    'variável nova só passa a valer no próximo boot do serviço.',
                detalhe: texto(corpo.message),
            };
        }

        if (corpo.liveOk === true) {
            return {
                estado: 'ok',
                rotulo: 'Ativo',
                tom: 'sucesso',
                titulo: 'Chave válida e respondendo',
                acao:
                    'Nada a fazer aqui. Se o assistente parou de responder, a causa é outra — ' +
                    'a chave foi testada agora e o provedor respondeu.',
                detalhe: variavelUsada(corpo),
            };
        }

        // A partir daqui a chave existe e o teste falhou. O que separa os dois
        // casos restantes é a ÚNICA informação que muda a ação de quem lê.
        if (corpo.quotaExceeded === true) {
            return {
                estado: 'cota',
                rotulo: 'Sem cota',
                tom: 'alerta',
                titulo: 'Chave correta, cota esgotada',
                acao:
                    'NÃO troque a chave — ela está certa. O que acabou foi a cota do período. ' +
                    'Espere a virada do dia ou ative o faturamento no Google AI Studio.',
                detalhe: texto(corpo.message),
            };
        }

        return {
            estado: 'recusada',
            rotulo: 'Chave recusada',
            tom: 'erro',
            titulo: 'Chave presente, mas recusada pelo provedor',
            acao:
                'Gere uma chave nova no Google AI Studio e confirme que a API "Generative ' +
                'Language" está habilitada no projeto dela. Depois publique no Render e refaça ' +
                'o deploy.',
            detalhe: texto(corpo.message),
        };
    }

    function indeterminado(titulo, acao) {
        return {
            estado: 'indeterminado',
            rotulo: 'Não verificado',
            tom: 'neutro',
            titulo: titulo,
            acao: acao,
            detalhe: '',
        };
    }

    function texto(valor) {
        return typeof valor === 'string' ? valor : '';
    }

    function variavelUsada(corpo) {
        return corpo && corpo.variavel ? `Variável em uso: ${corpo.variavel}` : '';
    }

    /**
     * Faz a chamada e normaliza o resultado para o formato que `vereditoGemini`
     * espera. Falha de rede e corpo ilegível viram estado, não exceção.
     */
    async function consultarGeminiStatus(fetchFn, baseUrl) {
        try {
            const resposta = await fetchFn(`${baseUrl}/ia/gemini-status`, {
                credentials: 'include',
                headers: { Accept: 'application/json' },
            });

            let corpo = null;
            try {
                corpo = await resposta.json();
            } catch (_erro) {
                corpo = null;
            }

            return { status: resposta.status, corpo: corpo };
        } catch (erro) {
            return { erroDeRede: true, motivo: erro && erro.message };
        }
    }

    /**
     * Escreve o veredito na tela.
     *
     * `textContent` em todos os campos, sem exceção: `detalhe` carrega a
     * mensagem de erro do provedor, que é texto de serviço externo. Interpretá-la
     * como HTML seria dar execução a uma string que não é nossa.
     */
    function aplicarVeredito(veredito, elementos) {
        const { cartao, titulo, acao, detalhe, painel } = elementos;

        if (cartao) {
            cartao.textContent = veredito.rotulo;
            cartao.classList.remove('skeleton', 'skeleton-line');
            cartao.dataset.tom = veredito.tom;
        }
        if (titulo) titulo.textContent = veredito.titulo;
        if (acao) acao.textContent = veredito.acao;
        if (detalhe) {
            detalhe.textContent = veredito.detalhe;
            detalhe.hidden = !veredito.detalhe;
        }
        if (painel) {
            painel.hidden = false;
            painel.dataset.tom = veredito.tom;
            // Reflow antes da classe: sem isso o navegador agrupa as duas
            // mudanças e a transição não acontece.
            void painel.offsetWidth;
            painel.classList.add('is-visible');
        }
    }

    function marcarCarregando(elementos) {
        const { cartao, painel, botao } = elementos;

        if (cartao) {
            // Skeleton, não spinner nem tela em branco: o card já tem tamanho,
            // então o que falta é o valor, não a caixa.
            cartao.textContent = '';
            cartao.classList.add('skeleton', 'skeleton-line');
            delete cartao.dataset.tom;
        }
        if (painel) {
            painel.hidden = true;
            painel.classList.remove('is-visible');
        }
        if (botao) {
            botao.disabled = true;
            const alvo = rotuloDoBotao(botao);
            botao.dataset.rotuloOriginal = botao.dataset.rotuloOriginal || alvo.textContent;
            alvo.textContent = 'Testando…';
        }
    }

    /**
     * O rótulo fica num `<span data-rotulo>` para o ícone do botão sobreviver:
     * escrever direto no `textContent` do `<button>` apagaria o `<i>` junto.
     */
    function rotuloDoBotao(botao) {
        return botao.querySelector('[data-rotulo]') || botao;
    }

    function liberarBotao(botao) {
        if (!botao) return;
        botao.disabled = false;
        if (botao.dataset.rotuloOriginal) {
            rotuloDoBotao(botao).textContent = botao.dataset.rotuloOriginal;
        }
    }

    async function testarChaveGemini(elementos, deps) {
        const { fetchFn, baseUrl } = deps;

        marcarCarregando(elementos);
        try {
            const resposta = await consultarGeminiStatus(fetchFn, baseUrl);
            aplicarVeredito(vereditoGemini(resposta), elementos);
        } finally {
            liberarBotao(elementos.botao);
        }
    }

    function iniciar(doc, deps) {
        const botao = doc.getElementById('btn-testar-gemini');
        if (!botao) return null;

        const elementos = {
            botao: botao,
            cartao: doc.getElementById('ia-status'),
            painel: doc.getElementById('gemini-resultado'),
            titulo: doc.getElementById('gemini-titulo'),
            acao: doc.getElementById('gemini-acao'),
            detalhe: doc.getElementById('gemini-detalhe'),
        };

        botao.addEventListener('click', () => {
            testarChaveGemini(elementos, deps);
        });

        return elementos;
    }

    const api = {
        vereditoGemini,
        consultarGeminiStatus,
        aplicarVeredito,
        marcarCarregando,
        testarChaveGemini,
        iniciar,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        window.DiagnosticoGemini = api;
        document.addEventListener('DOMContentLoaded', () => {
            iniciar(document, {
                fetchFn: window.fetch.bind(window),
                baseUrl: window.API_BASE_URL,
            });
        });
    }
})();
