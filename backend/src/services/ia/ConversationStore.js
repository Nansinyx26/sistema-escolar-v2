'use strict';

/**
 * ConversationStore.js — persistência e janela de memória das conversas.
 *
 * A PARTIR DAQUI O HISTÓRICO NÃO VEM MAIS DO CLIENTE.
 * Até a Fase 2 o front reenviava os turnos anteriores. Funcionava, mas deixava
 * a memória à mercê do que o cliente decidisse mandar. Agora o servidor é dono
 * do histórico: identidade, escola e conteúdo saem todos do banco.
 *
 * JANELA + RESUMO
 * ---------------
 * Reenviar a conversa inteira a cada mensagem cresce o custo de forma
 * quadrática. Então: as últimas N mensagens vão íntegras, e o que saiu da
 * janela é comprimido num resumo textual mantido no documento. O modelo recebe
 * "resumo do que veio antes" + os turnos recentes.
 */

const IaConversa = require('../../models/IaConversa');
const logger = require('../../utils/logger');

/** Turnos enviados íntegros ao modelo. Acima disso, entra no resumo. */
const JANELA_MENSAGENS = 20;

/** A partir de quantas mensagens fora da janela vale a pena recomprimir. */
const LOTE_RESUMO = 10;

/** Teto de caracteres do resumo — ele também ocupa contexto. */
const MAX_CHARS_RESUMO = 1500;

/** Conversas listadas na sidebar. */
const MAX_CONVERSAS_LISTA = 40;

/**
 * Título automático a partir da primeira pergunta.
 * Corta em palavra inteira para não gerar "Como faço para regis...".
 */
function tituloAPartirDe(texto) {
    const limpo = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!limpo) return 'Nova conversa';
    if (limpo.length <= 48) return limpo;

    const corte = limpo.slice(0, 48);
    const ultimoEspaco = corte.lastIndexOf(' ');
    return (ultimoEspaco > 20 ? corte.slice(0, ultimoEspaco) : corte) + '...';
}

/**
 * Filtro base de toda leitura: dono + escola.
 *
 * O `usuarioId` sozinho já isolaria, mas o `escolaId` entra junto de propósito
 * — um usuário com vínculo em duas escolas não deve ver, na escola B, o
 * histórico do que perguntou operando a escola A.
 */
function escopo(ctx, id) {
    const filtro = {
        usuarioId: String(ctx.usuarioId),
        escolaId: ctx.escolaId ? String(ctx.escolaId) : null
    };
    if (id) filtro._id = String(id);
    return filtro;
}

/**
 * Abre ou recupera a conversa desta requisição.
 *
 * @param {Object} ctx  { usuarioId, escolaId }
 * @param {string} [conversaId] quando ausente, cria uma conversa nova
 * @returns {Promise<Object>} documento da conversa
 */
async function abrir(ctx, conversaId) {
    if (conversaId) {
        const existente = await IaConversa.findOne(escopo(ctx, conversaId));
        // Id desconhecido (ou de outra pessoa/escola) não é erro: abrimos uma
        // conversa nova. Devolver 404 revelaria a existência do documento alheio.
        if (existente) return existente;
    }

    return new IaConversa({
        usuarioId: String(ctx.usuarioId),
        escolaId: ctx.escolaId ? String(ctx.escolaId) : null,
        titulo: 'Nova conversa',
        mensagens: []
    });
}

/**
 * Monta as mensagens que vão ao modelo: resumo do que passou + janela recente.
 *
 * @returns {Array<{papel, texto}>} no formato neutro do AIProvider
 */
function historicoParaModelo(conversa) {
    const mensagens = [];

    if (conversa.resumo) {
        // Entra como turno de usuário porque o papel 'sistema' é reservado ao
        // prompt montado pelo servidor — misturar os dois deixaria o resumo com
        // a mesma autoridade das regras, e é justamente ele que carrega texto
        // derivado do que o usuário escreveu.
        mensagens.push({
            papel: 'usuario',
            texto: `[Resumo do que já conversamos antes, para contexto]\n${conversa.resumo}`
        });
        mensagens.push({
            papel: 'assistente',
            texto: 'Entendido, tenho o contexto anterior.'
        });
    }

    for (const m of conversa.mensagens.slice(-JANELA_MENSAGENS)) {
        mensagens.push({ papel: m.papel, texto: m.texto });
    }

    return mensagens;
}

/**
 * Registra o par pergunta/resposta e persiste.
 *
 * @param {Object} conversa documento (novo ou carregado)
 * @param {Object} turno { pergunta, resposta, ferramentas }
 * @param {Function} [resumir] async (textoDeMensagens) => string
 */
async function registrarTurno(conversa, { pergunta, resposta, ferramentas = [] }, resumir) {
    const primeira = conversa.mensagens.length === 0;

    conversa.mensagens.push({ papel: 'usuario', texto: pergunta, em: new Date() });

    if (resposta && resposta.trim()) {
        conversa.mensagens.push({
            papel: 'assistente',
            texto: resposta,
            ferramentas: ferramentas.length > 0 ? [...new Set(ferramentas)] : undefined,
            em: new Date()
        });
    }

    if (primeira) conversa.titulo = tituloAPartirDe(pergunta);

    // `atualizadoEm` também reinicia a contagem do TTL: conversa em uso não
    // expira no meio.
    conversa.atualizadoEm = new Date();

    await comprimirSeNecessario(conversa, resumir);
    await conversa.save();

    return conversa;
}

/**
 * Comprime o excedente da janela num resumo textual.
 *
 * Só roda quando há pelo menos um LOTE fora da janela — resumir a cada turno
 * gastaria uma chamada ao modelo por mensagem, o que anularia a economia que o
 * resumo existe para produzir.
 */
async function comprimirSeNecessario(conversa, resumir) {
    const fora = conversa.mensagens.length - JANELA_MENSAGENS;
    if (fora < LOTE_RESUMO || typeof resumir !== 'function') return;

    const aResumir = conversa.mensagens.slice(0, fora);
    const texto = aResumir
        .map(m => `${m.papel === 'usuario' ? 'Pessoa' : 'Assistente'}: ${m.texto}`)
        .join('\n');

    try {
        const novoResumo = await resumir(
            conversa.resumo
                ? `Resumo anterior:\n${conversa.resumo}\n\nNovas mensagens:\n${texto}`
                : texto
        );

        if (novoResumo && novoResumo.trim()) {
            conversa.resumo = novoResumo.trim().slice(0, MAX_CHARS_RESUMO);
            conversa.mensagensResumidas += aResumir.length;
            // As mensagens comprimidas saem do documento: mantê-las faria a
            // conversa crescer sem teto e guardaria o texto que o resumo
            // justamente substituiu.
            conversa.mensagens = conversa.mensagens.slice(fora);
        }
    } catch (e) {
        // Falhar a compressão não pode derrubar a conversa: sem resumo o
        // histórico só fica mais longo, e a janela continua limitando o envio.
        logger.warn('[IA] Não foi possível comprimir o histórico da conversa', {
            err: e, action: 'ia.resumo'
        });
    }
}

/** Conversas do usuário para a sidebar (sem o corpo das mensagens). */
async function listar(ctx) {
    const conversas = await IaConversa.find(escopo(ctx))
        .select('titulo criadoEm atualizadoEm mensagens')
        .sort({ atualizadoEm: -1 })
        .limit(MAX_CONVERSAS_LISTA)
        .lean();

    return conversas.map(c => ({
        id: String(c._id),
        titulo: c.titulo,
        mensagens: (c.mensagens || []).length,
        criadoEm: c.criadoEm,
        atualizadoEm: c.atualizadoEm
    }));
}

/** Conversa completa, para retomar na interface. */
async function obter(ctx, conversaId) {
    const conversa = await IaConversa.findOne(escopo(ctx, conversaId)).lean();
    if (!conversa) return null;

    return {
        id: String(conversa._id),
        titulo: conversa.titulo,
        criadoEm: conversa.criadoEm,
        atualizadoEm: conversa.atualizadoEm,
        temResumoAnterior: Boolean(conversa.resumo),
        mensagensResumidas: conversa.mensagensResumidas || 0,
        mensagens: (conversa.mensagens || []).map(m => ({
            papel: m.papel,
            texto: m.texto,
            ferramentas: m.ferramentas,
            em: m.em
        }))
    };
}

/** Apaga uma conversa do próprio usuário. */
async function remover(ctx, conversaId) {
    const r = await IaConversa.deleteOne(escopo(ctx, conversaId));
    return r.deletedCount > 0;
}

module.exports = {
    abrir,
    registrarTurno,
    historicoParaModelo,
    listar,
    obter,
    remover,
    tituloAPartirDe,
    JANELA_MENSAGENS,
    LOTE_RESUMO
};
