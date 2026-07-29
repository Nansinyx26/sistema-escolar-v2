'use strict';

/**
 * IaCopilotoController.js — endpoint de conversa do copiloto (streaming SSE).
 *
 * POST /api/ia/chat
 *   body: { mensagem: string, historico?: [{ papel, texto }] }
 *   resposta: text/event-stream
 *
 * EVENTOS EMITIDOS
 *   { tipo: 'inicio', contexto: {...} }   metadados exibidos no cabeçalho do chat
 *   { tipo: 'delta' , texto: '...' }      pedaço de texto (token a token)
 *   { tipo: 'fim'   , motivo: '...' }     término normal
 *   { tipo: 'erro'  , mensagem: '...' }   falha já traduzida para o usuário
 *
 * POR QUE SSE POR POST (e não EventSource)
 * ----------------------------------------
 * `EventSource` não envia cabeçalhos personalizados, e toda escrita em /api
 * passa pelo `csrfValidator`, que exige o header `X-CSRF-Token`. O front então
 * usa `fetch` + `ReadableStream` para consumir o mesmo formato SSE — o que
 * ainda traz de brinde o `AbortController` que sustenta o botão "parar".
 */

const { obterProvider, ErroProvedorIA } = require('../services/ia/AIProvider');
const { construirContexto, montarSystemPrompt } = require('../services/ia/ContextBuilder');
const ToolRegistry = require('../services/ia/ToolRegistry');
const ConversationStore = require('../services/ia/ConversationStore');
const ConfirmationStore = require('../services/ia/ConfirmationStore');
const ExportadorConversa = require('../services/ia/ExportadorConversa');
const { comandosPara } = require('../services/ia/comandos');
const logger = require('../utils/logger');

/**
 * Teto de rodadas de ferramenta por mensagem.
 *
 * Cada rodada é uma ida e volta ao provedor. Sem teto, um modelo que insista em
 * reconsultar entra em laço e consome cota indefinidamente. 4 cobre o encadeamento
 * mais longo previsto (buscarAluno → consultarNotas → consultarFrequencia).
 */
const MAX_RODADAS_FERRAMENTA = 4;

/** Teto por mensagem. Acima disso é abuso de custo, não uso legítimo. */
const MAX_CHARS_MENSAGEM = 4000;

/** Intervalo do comentário-keepalive; sem ele proxies fecham a conexão ociosa. */
const INTERVALO_KEEPALIVE_MS = 15000;

/**
 * Abre a resposta como SSE.
 *
 * `no-transform` é o que impede o `compression()` global de bufferizar o
 * stream — sem ele a resposta chega inteira no final e o efeito token a token
 * desaparece. `X-Accel-Buffering` faz o mesmo do lado de proxies nginx.
 */
function abrirSSE(res) {
    res.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();
}

/** Serializa e despacha um evento. */
function enviar(res, payload) {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    // `compression` injeta `flush`; sem a chamada o chunk fica na fila interna.
    res.flush?.();
}

/**
 * Comprime um trecho antigo da conversa num parágrafo.
 *
 * Usa o mesmo provedor da conversa, sem ferramentas e sem streaming: é uma
 * tarefa de texto puro. O resultado alimenta `conversa.resumo`.
 */
function criarResumidor(provider) {
    return async (texto) => {
        const instrucao = [
            'Resuma a conversa abaixo em no máximo 6 linhas, em português do Brasil.',
            'Preserve: o assunto tratado, decisões tomadas e qualquer aluno, turma ou data citados —',
            'são eles que dão sentido a referências futuras como "e sobre aquele aluno?".',
            'Descarte saudações e formalidades. Escreva em terceira pessoa, sem comentar que é um resumo.',
            '',
            texto
        ].join('\n');

        let resumo = '';
        for await (const evento of provider.stream(
            [{ papel: 'usuario', texto: instrucao }], null, undefined
        )) {
            if (evento.tipo === 'texto') resumo += evento.texto;
        }
        return resumo;
    };
}

/**
 * POST /api/ia/chat
 */
async function chat(req, res) {
    const mensagem = typeof req.body?.mensagem === 'string' ? req.body.mensagem.trim() : '';

    if (!mensagem) {
        return res.status(400).json({ success: false, error: 'Envie uma mensagem para o assistente.' });
    }
    if (mensagem.length > MAX_CHARS_MENSAGEM) {
        return res.status(400).json({
            success: false,
            error: `Mensagem muito longa (máximo de ${MAX_CHARS_MENSAGEM} caracteres).`
        });
    }

    const provider = obterProvider();
    if (!provider.configurado()) {
        // 503 e não 500: é indisponibilidade de configuração, não defeito.
        return res.status(503).json({
            success: false,
            error: 'O assistente ainda não foi configurado neste servidor. Procure a administração do sistema.'
        });
    }

    let contexto;
    let ferramentas;
    let ctxFerramenta;
    let conversa;
    try {
        contexto = await construirContexto(req);

        // PRIMEIRA BARREIRA de autorização: o modelo só recebe a declaração das
        // ferramentas permitidas ao cargo desta sessão. A segunda barreira
        // (PermissionGuard) roda dentro de cada handler.
        // `incluirMutates`: a Fase 4 liga as ferramentas de escrita. Elas não
        // executam ao serem chamadas — devolvem um preview + token, e só o
        // endpoint de confirmação efetiva.
        ferramentas = ToolRegistry.declaracoesPara(contexto.usuario.perfil, { incluirMutates: true });
        ctxFerramenta = ToolRegistry.construirContextoFerramenta(req);
        contexto.temFerramentas = Array.isArray(ferramentas) && ferramentas.length > 0;

        // O HISTÓRICO AGORA VEM DO BANCO, não do corpo da requisição. O cliente
        // só diz QUAL conversa continuar; o conteúdo dela é do servidor. Um id
        // de outra pessoa (ou de outra escola) não casa com o escopo e resulta
        // numa conversa nova — sem revelar que o documento existe.
        conversa = await ConversationStore.abrir(ctxFerramenta, req.body?.conversaId);
    } catch (e) {
        logger.error('[IA] Falha ao montar o contexto do usuário', { err: e, action: 'ia.chat' });
        return res.status(500).json({ success: false, error: 'Não foi possível iniciar a conversa agora.' });
    }

    // ── A partir daqui a resposta é um stream: erros viram evento, não status ──
    abrirSSE(res);

    const controlador = new AbortController();
    // Usuário fechou a aba ou clicou em "parar": aborta a chamada ao provedor em
    // vez de continuar pagando por tokens que ninguém vai ler.
    req.on('close', () => controlador.abort());

    const keepalive = setInterval(() => {
        if (res.writableEnded) return;
        res.write(': keepalive\n\n');
        res.flush?.();
    }, INTERVALO_KEEPALIVE_MS);

    const encerrar = () => {
        clearInterval(keepalive);
        if (!res.writableEnded) res.end();
    };

    enviar(res, {
        tipo: 'inicio',
        contexto: {
            nome: contexto.usuario.nome,
            perfil: contexto.usuario.perfil,
            escola: contexto.escola?.nome || null,
            turmas: contexto.turmas,
            modulos: contexto.modulos,
            ferramentas: (ferramentas || []).map(f => f.name)
        },
        // O front usa isto para continuar a MESMA conversa na próxima mensagem
        // e para atualizar a sidebar sem recarregar a lista inteira.
        conversa: { id: String(conversa._id), titulo: conversa.titulo }
    });

    const mensagens = [
        { papel: 'sistema', texto: montarSystemPrompt(contexto) },
        ...ConversationStore.historicoParaModelo(conversa),
        { papel: 'usuario', texto: mensagem }
    ];

    // Acumuladores do turno: alimentam a persistência ao final.
    let respostaCompleta = '';
    const ferramentasUsadas = [];

    try {
        // ── Laço de ferramentas ──────────────────────────────────────────────
        // O modelo pode precisar consultar dados antes de saber o que responder.
        // Cada volta: streama o que vier de texto, e se vierem chamadas de
        // ferramenta, executa, devolve o resultado e roda de novo.
        let rodada = 0;
        let motivoFinal = 'completo';

        while (rodada < MAX_RODADAS_FERRAMENTA) {
            const chamadasPendentes = [];

            for await (const evento of provider.stream(mensagens, ferramentas, controlador.signal)) {
                if (res.writableEnded) break;

                if (evento.tipo === 'texto') {
                    respostaCompleta += evento.texto;
                    enviar(res, { tipo: 'delta', texto: evento.texto });
                } else if (evento.tipo === 'ferramenta') {
                    chamadasPendentes.push(...evento.chamadas);
                } else if (evento.tipo === 'fim') {
                    motivoFinal = evento.motivo;
                }
            }

            if (res.writableEnded) break;

            // Sem chamadas: o modelo já respondeu, a conversa desta mensagem acabou.
            if (chamadasPendentes.length === 0) break;

            // Registra o turno em que o modelo pediu as ferramentas — sem ele o
            // provedor não aceita o retorno na volta seguinte.
            mensagens.push({ papel: 'assistente', chamadas: chamadasPendentes });

            for (const chamada of chamadasPendentes) {
                // A interface mostra "consultando..." — sem isso a espera pela
                // consulta parece travamento.
                enviar(res, { tipo: 'ferramenta', nome: chamada.nome });
                ferramentasUsadas.push(chamada.nome);

                const resultado = await ToolRegistry.executar(
                    chamada.nome, chamada.argumentos, ctxFerramenta
                );

                // Ação de escrita: nada foi gravado ainda. O front recebe o
                // card de Confirmar/Cancelar/Editar; o token viaja SÓ aqui e
                // volta em POST /api/ia/confirmar.
                if (resultado.ok && resultado.dados?.requerConfirmacao) {
                    enviar(res, {
                        tipo: 'confirmacao',
                        confirmToken: resultado.dados.confirmToken,
                        acao: resultado.dados.acao,
                        resumo: resultado.dados.resumo,
                        dados: resultado.dados.dados,
                        expiraEm: resultado.dados.expiraEm
                    });
                }

                mensagens.push({
                    papel: 'ferramenta',
                    nome: chamada.nome,
                    // O token NÃO vai ao modelo: ele não precisa dele para
                    // redigir a resposta, e um segredo repetido no texto gerado
                    // acabaria persistido no histórico da conversa.
                    resultado: resultado.dados?.requerConfirmacao
                        ? { ok: true, dados: { ...resultado.dados, confirmToken: undefined } }
                        : resultado
                });
            }

            rodada++;
        }

        if (rodada >= MAX_RODADAS_FERRAMENTA) {
            logger.warn('[IA] Teto de rodadas de ferramenta atingido.', {
                action: 'ia.chat', perfil: contexto.usuario.perfil
            });
        }

        if (!res.writableEnded) {
            enviar(res, { tipo: 'fim', motivo: motivoFinal });
        }
    } catch (e) {
        if (e instanceof ErroProvedorIA) {
            // A mensagem já nasce em português e sem citar o provedor.
            enviar(res, { tipo: 'erro', mensagem: e.message });
        } else {
            logger.error('[IA] Erro inesperado durante o streaming', { err: e, action: 'ia.chat' });
            enviar(res, { tipo: 'erro', mensagem: 'Algo deu errado ao gerar a resposta. Tente novamente.' });
        }
    } finally {
        // Persiste o turno ANTES de fechar o stream, para que o front receba o
        // título gerado. Uma resposta parcial (o usuário parou no meio) também
        // é gravada: ela existiu na tela e faz parte do fio da conversa.
        if (respostaCompleta.trim() || conversa.mensagens.length > 0) {
            try {
                await ConversationStore.registrarTurno(
                    conversa,
                    { pergunta: mensagem, resposta: respostaCompleta, ferramentas: ferramentasUsadas },
                    criarResumidor(provider)
                );
                enviar(res, {
                    tipo: 'conversa',
                    id: String(conversa._id),
                    titulo: conversa.titulo
                });
            } catch (e) {
                // Falha ao gravar não invalida a resposta que a pessoa já leu.
                logger.error('[IA] Não foi possível gravar a conversa', {
                    err: e, action: 'ia.conversa'
                });
            }
        }

        encerrar();
    }
}

/**
 * POST /api/ia/confirmar — executa uma ação previamente apresentada.
 *
 * O corpo traz APENAS o token. Os parâmetros do que será feito vêm do banco,
 * gravados no momento do preview. É isso que impede a tela de confirmação de
 * virar teatro: não há como confirmar "criar a turma 6C" e executar outra coisa.
 */
async function confirmar(req, res) {
    const token = typeof req.body?.confirmToken === 'string' ? req.body.confirmToken : '';

    if (!token) {
        return res.status(400).json({ success: false, error: 'Confirmação inválida.' });
    }

    try {
        const ctx = ToolRegistry.construirContextoFerramenta(req);

        const consumo = await ConfirmationStore.consumir(ctx, token);
        if (!consumo.ok) {
            // 410 (Gone) e não 400: o token existiu e não vale mais. O front usa
            // isso para trocar o card por "expirou, peça de novo".
            return res.status(410).json({ success: false, error: consumo.erro });
        }

        const resultado = await ToolRegistry.executarConfirmada(consumo.acao, ctx);

        if (!resultado.ok) {
            return res.status(422).json({ success: false, error: resultado.erro });
        }

        return res.json({
            success: true,
            data: {
                acao: consumo.acao.ferramenta,
                resumo: consumo.acao.resumo,
                ...resultado.dados
            }
        });
    } catch (e) {
        logger.error('[IA] Falha no endpoint de confirmação', { err: e, action: 'ia.confirmar' });
        return res.status(500).json({ success: false, error: 'Não foi possível concluir a ação.' });
    }
}

/**
 * POST /api/ia/cancelar — descarta uma ação pendente.
 *
 * Não é estritamente necessário (o token expira em 5 minutos de qualquer
 * forma), mas deixar a ação viva depois de a pessoa clicar em "Cancelar" é uma
 * janela aberta sem motivo.
 */
async function cancelar(req, res) {
    try {
        const ctx = ToolRegistry.construirContextoFerramenta(req);
        await ConfirmationStore.cancelar(ctx, req.body?.confirmToken);
        // Sempre 200: se o token já não existia, o resultado desejado (nada
        // pendente) está alcançado do mesmo jeito.
        return res.json({ success: true });
    } catch (e) {
        logger.error('[IA] Falha ao cancelar ação pendente', { err: e, action: 'ia.confirmar' });
        return res.status(500).json({ success: false, error: 'Não foi possível cancelar.' });
    }
}

/**
 * GET /api/ia/conversas — lista da sidebar.
 *
 * Todo o escopo (dono + escola) é aplicado dentro do ConversationStore a partir
 * do contexto do servidor. Não há parâmetro de usuário nem de escola: não
 * existe forma de pedir a lista de outra pessoa.
 */
async function listarConversas(req, res) {
    try {
        const ctx = ToolRegistry.construirContextoFerramenta(req);
        const conversas = await ConversationStore.listar(ctx);
        return res.json({ success: true, data: conversas });
    } catch (e) {
        logger.error('[IA] Falha ao listar conversas', { err: e, action: 'ia.conversa' });
        return res.status(500).json({ success: false, error: 'Não foi possível carregar suas conversas.' });
    }
}

/**
 * GET /api/ia/conversas/:id — histórico completo para retomar na interface.
 */
async function obterConversa(req, res) {
    try {
        const ctx = ToolRegistry.construirContextoFerramenta(req);
        const conversa = await ConversationStore.obter(ctx, req.params.id);

        // 404 tanto para inexistente quanto para "de outra pessoa": distinguir
        // os dois casos confirmaria a existência do documento alheio.
        if (!conversa) {
            return res.status(404).json({ success: false, error: 'Conversa não encontrada.' });
        }
        return res.json({ success: true, data: conversa });
    } catch (e) {
        logger.error('[IA] Falha ao carregar conversa', { err: e, action: 'ia.conversa' });
        return res.status(500).json({ success: false, error: 'Não foi possível abrir esta conversa.' });
    }
}

/**
 * GET /api/ia/comandos — comandos da paleta permitidos a este cargo.
 *
 * A lista é montada no servidor. Se morasse no JavaScript da página, seria
 * enfeite: bastaria abrir o DevTools para ver (e tentar) os comandos de outro
 * perfil. Isso não substitui a autorização — cada comando termina numa
 * ferramenta ou numa rota que tem o próprio controle.
 */
function listarComandos(req, res) {
    const perfil = String(req.user?.perfil || '').toLowerCase();
    return res.json({ success: true, data: comandosPara(perfil) });
}

/**
 * POST /api/ia/exportar/:id — baixa a conversa em TXT, PDF ou DOCX.
 *
 * A conversa é lida com o MESMO escopo (dono + escola) da leitura normal, então
 * não há como exportar o histórico de outra pessoa.
 */
async function exportarConversa(req, res) {
    try {
        const ctx = ToolRegistry.construirContextoFerramenta(req);
        const conversa = await ConversationStore.obter(ctx, req.params.id);

        if (!conversa) {
            return res.status(404).json({ success: false, error: 'Conversa não encontrada.' });
        }

        const formato = String(req.body?.formato || req.query?.formato || 'txt').toLowerCase();
        const { buffer, mime, nome } = await ExportadorConversa.exportar(
            conversa, formato, req.user?.nome
        );

        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
        // O arquivo carrega conteúdo de conversa: nada de cache intermediário.
        res.setHeader('Cache-Control', 'no-store');
        return res.send(buffer);
    } catch (e) {
        if (e.formatoInvalido) {
            return res.status(400).json({ success: false, error: e.message });
        }
        if (e.semPdf) {
            return res.status(503).json({ success: false, error: e.message });
        }
        logger.error('[IA] Falha ao exportar conversa', { err: e, action: 'ia.exportar' });
        return res.status(500).json({ success: false, error: 'Não foi possível exportar esta conversa.' });
    }
}

/**
 * DELETE /api/ia/conversas/:id
 */
async function removerConversa(req, res) {
    try {
        const ctx = ToolRegistry.construirContextoFerramenta(req);
        const removida = await ConversationStore.remover(ctx, req.params.id);

        if (!removida) {
            return res.status(404).json({ success: false, error: 'Conversa não encontrada.' });
        }
        return res.json({ success: true });
    } catch (e) {
        logger.error('[IA] Falha ao remover conversa', { err: e, action: 'ia.conversa' });
        return res.status(500).json({ success: false, error: 'Não foi possível apagar esta conversa.' });
    }
}

module.exports = {
    chat,
    confirmar,
    cancelar,
    listarConversas,
    obterConversa,
    removerConversa,
    listarComandos,
    exportarConversa,
    MAX_CHARS_MENSAGEM
};
