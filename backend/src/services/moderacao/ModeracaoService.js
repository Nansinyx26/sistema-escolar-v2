/**
 * ModeracaoService — o orquestrador: recebe {tipo, conteudo, contexto} e
 * devolve um veredito, registrando a ocorrência.
 *
 * O QUE ESTÁ LIGADO NA FASE 0
 * ===========================
 * Só a Camada 1 (léxico), que já existia e já roda in-process. Nenhum provedor
 * externo: `MODERACAO_TEXTO_CLASSIFICADOR`, `MODERACAO_AUDIO_STT` e
 * `MODERACAO_IMAGEM_PROVEDOR` nascem em `none`. Sem chave configurada, o
 * sistema se comporta exatamente como antes desta pasta existir — o que muda é
 * que agora o bloqueio da Camada 1 deixa RASTRO no painel em vez de virar uma
 * linha de log que ninguém lê.
 *
 * MODO OBSERVAR × APLICAR (§9.1)
 * ==============================
 * `MODERACAO_MODO=observar` (padrão) registra a ocorrência mas NÃO altera o
 * destino da mensagem. É o modo que permite medir taxa de falso positivo com
 * dados reais antes de bloquear qualquer coisa de pai ou de professor. A
 * Camada 1 continua bloqueando como sempre bloqueou — ela é anterior a isto e
 * não está sob este interruptor.
 */

const crypto = require('node:crypto');

const ModeracaoOcorrencia = require('../../models/ModeracaoOcorrencia');
const lexicoAdapter = require('./adaptadores/lexicoAdapter');
const matriz = require('./politicas/matrizSeveridade');
const reincidencia = require('./politicas/reincidencia');
const logger = require('../../utils/logger');

/** Só normaliza o bastante para o hash reconhecer o mesmo texto reenviado. */
function hashDoTexto(texto) {
    const normalizado = String(texto || '')
        .toLowerCase()
        .normalize('NFD')
        // Marcas combinantes (U+0300–U+036F): "não" e "nao" precisam gerar o
        // mesmo hash, senão trocar um acento burla a detecção de reenvio.
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalizado) return null;
    return crypto.createHash('sha256').update(normalizado, 'utf8').digest('hex');
}

function hashDoBinario(buffer) {
    if (!buffer) return null;
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function moderacaoAtiva() {
    return String(process.env.MODERACAO_ATIVA || 'true').toLowerCase() !== 'false';
}

function modo() {
    const valor = String(process.env.MODERACAO_MODO || 'observar').toLowerCase();
    return valor === 'aplicar' ? 'aplicar' : 'observar';
}

/**
 * Analisa um texto e registra a ocorrência, se houver.
 *
 * @param {Object} entrada
 * @param {string} entrada.texto
 * @param {Object} entrada.contexto
 * @param {string} [entrada.contexto.escolaId]
 * @param {string} [entrada.contexto.remetenteId]
 * @param {string} [entrada.contexto.remetentePerfil]
 * @param {string} [entrada.contexto.destinatarioId]
 * @param {string} [entrada.contexto.mensagemId]
 * @returns {Promise<{severidade:string, decisao:string|null, entrega:boolean,
 *                    fila:boolean, ocorrencia:Object|null, modo:string}>}
 */
async function analisarTexto({ texto, contexto = {} }) {
    if (!moderacaoAtiva()) return vereditoNeutro();

    const lexico = lexicoAdapter.analisar(texto);

    // `nenhuma` não vira ocorrência. Registrar "nada aconteceu" a cada mensagem
    // encheria a coleção com ruído e faria o painel medir volume de chat, não
    // volume de moderação.
    if (lexico.severidade === 'nenhuma') return vereditoNeutro();

    const reincidente = await reincidencia
        .ehReincidente(contexto.remetenteId, { escolaId: contexto.escolaId })
        .catch(() => false);

    const decisao = matriz.decidir({
        severidadeLexico: lexico.severidade,
        categorias: lexico.categorias,
        perfilRemetente: contexto.remetentePerfil,
        reincidente,
    });

    const ocorrencia = await registrarOcorrencia({
        tipoConteudo: 'texto',
        camada: 'lexico',
        conteudoHash: hashDoTexto(texto),
        termosDetectados: lexico.termos,
        categorias: lexico.categorias,
        provedor: lexico.provedor,
        provedorLatenciaMs: lexico.latenciaMs,
        decisao,
        contexto,
    });

    return { ...decisao, ocorrencia, modo: modo() };
}

/**
 * Registra a ocorrência. Nunca propaga exceção: se o registro falhar, o envio
 * da mensagem não pode falhar junto — a moderação é uma camada de observação
 * aqui, não uma dependência do chat (P5).
 */
async function registrarOcorrencia({
    tipoConteudo,
    camada,
    conteudoHash,
    termosDetectados = [],
    categorias = {},
    provedor,
    provedorLatenciaMs,
    decisao,
    contexto = {},
    gridfsId = null,
    extras = {},
}) {
    try {
        const temBinario = Boolean(gridfsId);

        return await ModeracaoOcorrencia.create({
            escolaId: contexto.escolaId ? String(contexto.escolaId) : undefined,
            mensagemId: contexto.mensagemId ? String(contexto.mensagemId) : null,
            gridfsId: gridfsId ? String(gridfsId) : null,
            tipoConteudo,
            conteudoHash,
            remetenteId: contexto.remetenteId ? String(contexto.remetenteId) : undefined,
            remetentePerfil: contexto.remetentePerfil,
            destinatarioId: contexto.destinatarioId ? String(contexto.destinatarioId) : undefined,
            camada,
            severidade: decisao.severidade,
            categorias,
            termosDetectados,
            provedor,
            provedorLatenciaMs,
            decisaoAutomatica: decisao.decisao,
            // LEVE entra como já resolvida: foi entregue com registro, não há o
            // que um humano decidir. Só o que vai para a fila nasce 'pendente'.
            statusAtual: decisao.fila ? 'pendente' : 'mantida',
            expiraEm: ModeracaoOcorrencia.prazoDeRetencao(temBinario),
            // Campos que só a denúncia aberta usa (categoria e relato). Vêm por
            // `extras` para não obrigar os cinco chamadores restantes a passar
            // `undefined` em dois parâmetros que não lhes dizem respeito.
            ...extras,
        });
    } catch (erro) {
        logger.error('[Moderacao] Falha ao registrar ocorrência', {
            erro: erro.message,
            camada,
            tipoConteudo,
        });
        return null;
    }
}

/**
 * Registra uma denúncia feita por um usuário sobre mensagem que recebeu.
 *
 * Denúncia entra sempre como MODERADA e sempre na fila: quem denuncia não
 * classifica gravidade, e tratar denúncia como bloqueio automático faria do
 * botão de denunciar uma arma (R7 da spec).
 */
async function registrarDenuncia({ mensagemId, motivo, contexto = {} }) {
    const decisao = {
        severidade: 'moderada',
        decisao: 'em_revisao',
        entrega: false,
        fila: true,
        prioridade: 'normal',
        escalonar: false,
    };

    const ocorrencia = await registrarOcorrencia({
        tipoConteudo: 'texto',
        camada: 'denuncia',
        conteudoHash: hashDoTexto(motivo),
        decisao,
        contexto: { ...contexto, mensagemId },
    });

    return { ...decisao, ocorrencia, modo: modo() };
}

/**
 * Categorias que a escola precisa tratar como grave desde a entrada.
 *
 * Não é gravidade do conteúdo — é gravidade do RISCO. Violência, assédio e
 * automutilação envolvem integridade física de criança: esperar a fila normal
 * (24h de prazo) pode ser tarde. As demais entram como moderadas, seguindo a
 * mesma regra da denúncia de mensagem — quem denuncia não classifica gravidade.
 */
const CATEGORIAS_GRAVES = ['violencia', 'assedio', 'automutilacao'];

/**
 * Canal aberto de denúncia (ECA Digital) — denúncia SEM mensagem vinculada.
 *
 * POR QUE NÃO DAVA PARA REUSAR `registrarDenuncia`
 * ------------------------------------------------
 * Aquela função denuncia UMA mensagem do chat: existe `mensagemId`, existe
 * conteúdo moderável, e a fila sabe o que revisar. O que o ECA exige é outra
 * coisa: um canal onde criança ou responsável relate bullying, assédio ou
 * discriminação que aconteceu — inclusive fora do sistema, no pátio da escola.
 * Não há mensagem para apontar, e exigir uma fecharia o canal justamente para o
 * caso mais comum.
 *
 * NADA É BLOQUEADO POR ESTA CHAMADA
 * ---------------------------------
 * A denúncia não remove mensagem, não suspende conta e não notifica o
 * denunciado. Ela cria um item de fila para a equipe da escola apurar. Fazer
 * diferente transformaria o botão numa arma contra desafeto (R7 da spec).
 *
 * @param {object} entrada
 * @param {string} entrada.categoria uma das do enum `categoriaDenuncia`.
 * @param {string} entrada.relato    o que a pessoa escreveu (limitado a 2000).
 * @param {object} entrada.contexto  `{ escolaId, remetenteId, remetentePerfil }`.
 */
async function registrarDenunciaAberta({ categoria, relato, contexto = {} }) {
    const grave = CATEGORIAS_GRAVES.includes(categoria);
    const decisao = {
        severidade: grave ? 'grave' : 'moderada',
        decisao: 'em_revisao',
        entrega: true,
        fila: true,
        prioridade: grave ? 'alta' : 'normal',
        escalonar: grave,
    };

    const ocorrencia = await registrarOcorrencia({
        tipoConteudo: 'texto',
        camada: 'denuncia',
        conteudoHash: hashDoTexto(relato),
        decisao,
        contexto,
        extras: { categoriaDenuncia: categoria, relato },
    });

    return { ...decisao, ocorrencia, modo: modo() };
}

/**
 * Liberação por decurso de prazo — §5.2.
 *
 * Item em revisão sem decisão em `MODERACAO_PRAZO_FILA_HORAS` (padrão 24):
 *   - MODERADA  ⇒ liberado, com registro de "expirada";
 *   - GRAVE/CRÍTICA ⇒ permanece bloqueado e escalona para a direção.
 *
 * Sem isso a fila vira cemitério de mensagem legítima toda vez que a
 * coordenação passa uma semana sem abrir o painel.
 *
 * @returns {Promise<{liberadas:number, escalonadas:number}>}
 */
async function expirarPendencias({ agora = new Date() } = {}) {
    const horas = Number.parseInt(process.env.MODERACAO_PRAZO_FILA_HORAS, 10) || 24;
    const limite = new Date(agora.getTime() - horas * 60 * 60 * 1000);

    const vencidas = await ModeracaoOcorrencia.find({
        statusAtual: 'pendente',
        criadoEm: { $lte: limite },
    }).lean();

    let liberadas = 0;
    let escalonadas = 0;

    for (const ocorrencia of vencidas) {
        const grave = ocorrencia.severidade === 'grave' || ocorrencia.severidade === 'critica';

        if (grave) {
            escalonadas += 1;
            logger.warn(
                '[Moderacao] Ocorrência grave vencida sem decisão — escalonando à direção',
                {
                    ocorrenciaId: String(ocorrencia._id),
                    severidade: ocorrencia.severidade,
                }
            );
            continue;
        }

        await ModeracaoOcorrencia.updateOne(
            { _id: ocorrencia._id, statusAtual: 'pendente' },
            { $set: { statusAtual: 'expirada' } }
        );
        liberadas += 1;
    }

    return { liberadas, escalonadas };
}

function vereditoNeutro() {
    return {
        severidade: 'nenhuma',
        decisao: null,
        entrega: true,
        fila: false,
        prioridade: 'normal',
        escalonar: false,
        ocorrencia: null,
        modo: modo(),
    };
}

module.exports = {
    analisarTexto,
    registrarOcorrencia,
    registrarDenuncia,
    registrarDenunciaAberta,
    CATEGORIAS_GRAVES,
    expirarPendencias,
    hashDoTexto,
    hashDoBinario,
    moderacaoAtiva,
    modo,
};
