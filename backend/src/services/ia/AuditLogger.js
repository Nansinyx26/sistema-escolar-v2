'use strict';

/**
 * AuditLogger.js — trilha de auditoria das ações executadas pelo copiloto.
 *
 * Não é um sistema novo: escreve no MESMO `AuditoriaService`/`AuditLog` que o
 * resto da aplicação usa, para que uma investigação futura ("quem criou essa
 * turma?") não precise saber que existe um caminho separado por IA.
 *
 * O que distingue um registro do copiloto é o prefixo `IA_` na ação e o campo
 * `viaAssistente` nos detalhes — assim dá para filtrar, sem fragmentar a trilha.
 *
 * REGISTRA-SE TAMBÉM O QUE FALHOU. Uma tentativa de escrita que morreu na
 * validação é justamente o que interessa numa apuração de abuso; guardar só os
 * sucessos deixaria o log contando metade da história.
 */

// `auditHelper.logAction` e não `AuditoriaService.log`: é ele que grava o
// `escolaId` a partir de `req.escolaId` (sem isso a ação não apareceria na
// auditoria filtrada por escola do diretor) e que mapeia os detalhes para os
// campos que o schema realmente tem.
//
// ARMADILHA DO SCHEMA: `AuditLog.detalhes` é um subdocumento TIPADO, com apenas
// `valorAnterior`, `valorNovo` e `descricao`. Qualquer outra chave é descartada
// em silêncio pelo Mongoose. Por isso a carga estruturada vai dentro de
// `valorNovo`, que é Mixed — e é semanticamente o campo certo para "o que foi
// gravado".
const { logAction } = require('../../utils/auditHelper');
const logger = require('../../utils/logger');

/**
 * Campos que nunca entram na trilha, mesmo que apareçam nos parâmetros.
 * O log de auditoria é lido por gestão e exportado — não é lugar para corpo de
 * comunicado com dado pessoal nem para imagem em base64.
 */
const CAMPOS_OMITIDOS = new Set(['conteudo', 'imagens', 'arquivos', 'senha', 'codigoSecreto']);

/** Teto por valor: evita que um parâmetro longo inche a coleção de auditoria. */
const MAX_CHARS_VALOR = 300;

function resumirParametros(parametros) {
    const saida = {};
    for (const [chave, valor] of Object.entries(parametros || {})) {
        if (CAMPOS_OMITIDOS.has(chave)) {
            saida[chave] = '[omitido na auditoria]';
            continue;
        }
        if (typeof valor === 'string') {
            saida[chave] = valor.length > MAX_CHARS_VALOR
                ? valor.slice(0, MAX_CHARS_VALOR) + '...'
                : valor;
        } else if (Array.isArray(valor)) {
            saida[chave] = valor.slice(0, 20);
        } else {
            saida[chave] = valor;
        }
    }
    return saida;
}

/**
 * Grava a execução de uma ferramenta `mutates`.
 *
 * @param {Object} ctx        contexto de ferramenta (traz `req` para IP/user-agent)
 * @param {Object} dados
 * @param {string} dados.ferramenta
 * @param {Object} dados.parametros
 * @param {string} dados.resumo
 * @param {boolean} dados.sucesso
 * @param {string} [dados.recursoId]  id do documento criado
 * @param {string} [dados.erro]       motivo, quando falhou
 */
async function registrarAcao(ctx, { ferramenta, parametros, resumo, sucesso, recursoId, erro }) {
    try {
        const descricao = sucesso
            ? `[Assistente] ${resumo} — executado por ${ctx.nome || 'usuário'} (${ctx.perfil}).`
            : `[Assistente] TENTATIVA FALHOU — ${resumo}. Motivo: ${erro || 'não informado'}.`;

        await logAction(ctx.req, `IA_${ferramenta.toUpperCase()}`, 'AssistenteEscola', {
            recursoId,
            descricao,
            valorNovo: {
                viaAssistente: true,
                ferramenta,
                resumo,
                sucesso,
                erro: erro || undefined,
                parametros: resumirParametros(parametros)
            },
            escolaId: ctx.escolaId || undefined
        });
    } catch (e) {
        // A auditoria não pode derrubar a ação que ela registra — mas a falha
        // precisa aparecer, porque um log que some é um controle que não existe.
        logger.error('[IA] Falha ao gravar a auditoria de uma ação do assistente', {
            err: e, action: 'ia.auditoria', ferramenta
        });
    }
}

module.exports = { registrarAcao, resumirParametros };
