'use strict';

/**
 * AIProvider.js — abstração do provedor de modelo de linguagem.
 *
 * OBJETIVO DE DESENHO
 * -------------------
 * Nenhum outro arquivo do copiloto pode saber QUAL provedor está em uso.
 * Trocar Gemini por Claude/OpenAI deve ser: escrever uma subclasse aqui e mudar
 * a variável `IA_PROVIDER`. Por isso tudo que é específico de um provedor
 * (formato de mensagem, nome de campo, formato do stream) fica confinado nesta
 * classe, e a interface exposta usa um vocabulário neutro em português.
 *
 * INTERFACE ÚNICA
 * ---------------
 *   provider.stream(mensagens, ferramentas, signal) -> AsyncGenerator<Evento>
 *
 * `mensagens` (formato neutro):
 *   { papel: 'sistema'   , texto }                                  instrução de sistema
 *   { papel: 'usuario'   , texto }                                  turno do usuário
 *   { papel: 'assistente', texto }                                  turno do modelo
 *   { papel: 'assistente', chamadas: [{ id, nome, argumentos }] }   modelo pediu ferramenta
 *   { papel: 'ferramenta', nome, resultado }                        retorno da ferramenta
 *
 * `ferramentas` (formato neutro, usado a partir da Fase 2):
 *   [{ name, description, schema }]  — `schema` é JSON Schema dos parâmetros.
 *   Passe `null` ou `[]` para desativar tool calling.
 *
 * `signal`: AbortSignal. Cancelar o signal interrompe a geração no provedor
 *   (é o que sustenta o botão "parar geração" da interface).
 *
 * Eventos emitidos (sempre neutros):
 *   { tipo: 'texto'     , texto }
 *   { tipo: 'ferramenta', chamadas: [{ id, nome, argumentos }] }
 *   { tipo: 'fim'       , motivo }   'completo' | 'limite_tokens' | 'seguranca' | 'cancelado'
 *
 * REGRA DE OURO: a chave da API só existe neste processo. Nada aqui é enviado
 * ao front-end, e o nome comercial do provedor nunca aparece em texto que o
 * usuário final possa ler (ver assistantPersona.js).
 */

const fetch = require('node-fetch');
const logger = require('../../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// Erro tipado
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erro de provedor com metadados que o controller usa para escolher a mensagem
 * mostrada ao usuário — sem nunca repassar o texto cru do provedor, que pode
 * conter o nome comercial dele ou detalhes internos da conta.
 */
class ErroProvedorIA extends Error {
    constructor(mensagem, { status = 502, semChave = false, cotaExcedida = false, cancelado = false } = {}) {
        super(mensagem);
        this.name = 'ErroProvedorIA';
        this.status = status;
        this.semChave = semChave;
        this.cotaExcedida = cotaExcedida;
        this.cancelado = cancelado;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Contrato base
// ─────────────────────────────────────────────────────────────────────────────

class AIProvider {
    /** Identificador interno (aparece só em log/telemetria, nunca ao usuário). */
    get nome() {
        throw new Error('AIProvider.nome não implementado.');
    }

    /** @returns {boolean} true se há credencial para operar. */
    configurado() {
        throw new Error('AIProvider.configurado não implementado.');
    }

    /**
     * @param {Array<Object>} mensagens
     * @param {Array<Object>|null} ferramentas
     * @param {AbortSignal} [signal]
     * @returns {AsyncGenerator<Object>}
     */
    // eslint-disable-next-line require-yield
    async *stream(mensagens, ferramentas, signal) {
        throw new Error('AIProvider.stream não implementado.');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementação: Google Gemini
// ─────────────────────────────────────────────────────────────────────────────

const MODELO_PADRAO = 'gemini-2.0-flash';

/**
 * Teto de entrada. O histórico já chega recortado pelo controller, mas este é o
 * limite duro: protege contra um turno único gigante inflar o custo.
 */
const MAX_CHARS_POR_MENSAGEM = 8000;

class GeminiProvider extends AIProvider {
    constructor() {
        super();
        // Mesma cascata de nomes usada por voiceService.js e ChatbotService.js —
        // no Render a chave está publicada como GEMINI_KEY.
        this.chave = process.env.GEMINI_KEY
            || process.env.GEMINI_API_KEY
            || process.env.GOOGLE_TTS_API_KEY
            || process.env.GOOGLE_API_KEY;
        this.modelo = process.env.IA_MODELO || MODELO_PADRAO;
        this.maxTokensSaida = Number(process.env.IA_MAX_TOKENS_SAIDA) || 2048;
        this.temperatura = Number(process.env.IA_TEMPERATURA) || 0.7;
    }

    get nome() {
        return 'gemini';
    }

    configurado() {
        return Boolean(this.chave);
    }

    // ── Tradução: formato neutro → formato do provedor ───────────────────────

    /**
     * Gemini separa a instrução de sistema (`systemInstruction`) do histórico
     * (`contents`), e chama o assistente de 'model'. Toda essa tradução vive
     * aqui — quem chama nunca precisa saber.
     */
    _traduzirMensagens(mensagens) {
        const instrucoesSistema = [];
        const contents = [];

        for (const msg of mensagens || []) {
            if (!msg || !msg.papel) continue;

            if (msg.papel === 'sistema') {
                if (msg.texto) instrucoesSistema.push(this._recortar(msg.texto));
                continue;
            }

            if (msg.papel === 'ferramenta') {
                // Retorno de ferramenta. Gemini espera papel 'user' com functionResponse.
                contents.push({
                    role: 'user',
                    parts: [{
                        functionResponse: {
                            name: msg.nome,
                            response: { resultado: msg.resultado ?? null }
                        }
                    }]
                });
                continue;
            }

            const role = msg.papel === 'assistente' ? 'model' : 'user';

            // Turno em que o modelo pediu ferramentas
            if (Array.isArray(msg.chamadas) && msg.chamadas.length > 0) {
                contents.push({
                    role,
                    parts: msg.chamadas.map(c => ({
                        functionCall: { name: c.nome, args: c.argumentos || {} }
                    }))
                });
                continue;
            }

            const texto = this._recortar(msg.texto);
            if (!texto) continue;
            contents.push({ role, parts: [{ text: texto }] });
        }

        return { instrucoesSistema, contents };
    }

    _recortar(texto) {
        const t = typeof texto === 'string' ? texto : '';
        if (t.length <= MAX_CHARS_POR_MENSAGEM) return t;
        return t.slice(0, MAX_CHARS_POR_MENSAGEM);
    }

    /**
     * JSON Schema neutro → `functionDeclarations` do Gemini.
     * Usado a partir da Fase 2; já implementado para que o ToolRegistry não
     * precise conhecer o formato do provedor.
     */
    _traduzirFerramentas(ferramentas) {
        if (!Array.isArray(ferramentas) || ferramentas.length === 0) return undefined;
        return [{
            functionDeclarations: ferramentas.map(f => ({
                name: f.name,
                description: f.description,
                parameters: f.schema || { type: 'object', properties: {} }
            }))
        }];
    }

    // ── Streaming ────────────────────────────────────────────────────────────

    async *stream(mensagens, ferramentas, signal) {
        if (!this.configurado()) {
            throw new ErroProvedorIA('Serviço de assistente não configurado neste servidor.', {
                status: 503, semChave: true
            });
        }

        const { instrucoesSistema, contents } = this._traduzirMensagens(mensagens);

        if (contents.length === 0) {
            throw new ErroProvedorIA('Nenhuma mensagem para enviar ao assistente.', { status: 400 });
        }

        const corpo = {
            contents,
            generationConfig: {
                temperature: this.temperatura,
                maxOutputTokens: this.maxTokensSaida
            }
        };
        if (instrucoesSistema.length > 0) {
            corpo.systemInstruction = { parts: [{ text: instrucoesSistema.join('\n\n') }] };
        }
        const tools = this._traduzirFerramentas(ferramentas);
        if (tools) corpo.tools = tools;

        // `alt=sse` faz o Gemini responder em Server-Sent Events em vez de um
        // array JSON só entregue no final — é o que permite token a token.
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.modelo)}:streamGenerateContent?alt=sse&key=${this.chave}`;

        let resposta;
        try {
            resposta = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(corpo),
                signal
            });
        } catch (e) {
            if (e.name === 'AbortError' || signal?.aborted) {
                yield { tipo: 'fim', motivo: 'cancelado' };
                return;
            }
            logger.error('[IA] Falha de rede ao contatar o provedor', { err: e, action: 'ia.stream' });
            throw new ErroProvedorIA('Não foi possível falar com o assistente agora.', { status: 502 });
        }

        if (!resposta.ok) {
            // O corpo do erro pode citar o nome comercial do provedor e detalhes
            // do projeto: fica no log, nunca na resposta ao usuário.
            const detalhe = await resposta.text().catch(() => '');
            const cota = resposta.status === 429 || /quota|rate limit/i.test(detalhe);
            logger.warn('[IA] Provedor recusou a requisição', {
                status: resposta.status, action: 'ia.stream', detalhe: detalhe.slice(0, 500)
            });
            throw new ErroProvedorIA(
                cota
                    ? 'O assistente atingiu o limite de uso do momento. Tente novamente em alguns minutos.'
                    : 'O assistente está indisponível no momento.',
                { status: cota ? 429 : 502, cotaExcedida: cota }
            );
        }

        yield* this._lerSSE(resposta.body, signal);
    }

    /**
     * Consome o corpo SSE do provedor e emite eventos neutros.
     *
     * O parser é próprio (e não uma lib) porque o formato é trivial e porque o
     * corte de pacote TCP cai no meio de um `data:` com frequência — o buffer
     * abaixo é justamente o que impede um chunk partido de virar JSON inválido.
     */
    async *_lerSSE(corpo, signal) {
        let buffer = '';
        let motivo = 'completo';

        try {
            for await (const pedaco of corpo) {
                if (signal?.aborted) {
                    yield { tipo: 'fim', motivo: 'cancelado' };
                    return;
                }

                buffer += pedaco.toString('utf8');

                // Um evento SSE termina em linha em branco; até lá, acumula.
                let quebra;
                while ((quebra = buffer.indexOf('\n')) !== -1) {
                    const linha = buffer.slice(0, quebra).trim();
                    buffer = buffer.slice(quebra + 1);

                    if (!linha.startsWith('data:')) continue;
                    const carga = linha.slice(5).trim();
                    if (!carga || carga === '[DONE]') continue;

                    let json;
                    try {
                        json = JSON.parse(carga);
                    } catch {
                        // Fragmento incompleto: devolve ao buffer para a próxima volta.
                        buffer = `data: ${carga}\n${buffer}`;
                        break;
                    }

                    const candidato = json.candidates?.[0];
                    if (!candidato) continue;

                    const chamadas = [];
                    for (const parte of candidato.content?.parts || []) {
                        if (typeof parte.text === 'string' && parte.text.length > 0) {
                            yield { tipo: 'texto', texto: parte.text };
                        }
                        if (parte.functionCall) {
                            chamadas.push({
                                id: `${parte.functionCall.name}-${chamadas.length}`,
                                nome: parte.functionCall.name,
                                argumentos: parte.functionCall.args || {}
                            });
                        }
                    }
                    if (chamadas.length > 0) {
                        yield { tipo: 'ferramenta', chamadas };
                    }

                    if (candidato.finishReason) {
                        motivo = MOTIVOS[candidato.finishReason] || 'completo';
                    }
                }
            }
        } catch (e) {
            if (e.name === 'AbortError' || signal?.aborted) {
                yield { tipo: 'fim', motivo: 'cancelado' };
                return;
            }
            logger.error('[IA] Stream do provedor interrompido', { err: e, action: 'ia.stream' });
            throw new ErroProvedorIA('A resposta do assistente foi interrompida.', { status: 502 });
        }

        yield { tipo: 'fim', motivo };
    }
}

/** Motivos de parada do provedor → vocabulário neutro. */
const MOTIVOS = {
    STOP: 'completo',
    MAX_TOKENS: 'limite_tokens',
    SAFETY: 'seguranca',
    RECITATION: 'seguranca',
    OTHER: 'completo'
};

// ─────────────────────────────────────────────────────────────────────────────
// Fábrica
// ─────────────────────────────────────────────────────────────────────────────

const PROVEDORES = {
    gemini: GeminiProvider
};

let instancia = null;

/**
 * Devolve o provedor configurado (singleton).
 * `IA_PROVIDER` seleciona a implementação; o padrão é a que já tem chave
 * publicada no ambiente do projeto.
 */
function obterProvider() {
    if (instancia) return instancia;
    const escolhido = (process.env.IA_PROVIDER || 'gemini').toLowerCase();
    const Classe = PROVEDORES[escolhido];
    if (!Classe) {
        logger.error(`[IA] Provedor desconhecido em IA_PROVIDER: "${escolhido}" — usando o padrão.`, {
            action: 'ia.provider'
        });
        instancia = new GeminiProvider();
        return instancia;
    }
    instancia = new Classe();
    return instancia;
}

/** Reinicia o singleton — usado apenas por testes que trocam variáveis de ambiente. */
function _resetarProvider() {
    instancia = null;
}

module.exports = {
    AIProvider,
    GeminiProvider,
    ErroProvedorIA,
    obterProvider,
    _resetarProvider
};
