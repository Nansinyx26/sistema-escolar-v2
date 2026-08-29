/**
 * exigirAceiteTermo.js — a barreira que o `js/termo-audio-imagem.js` declara
 * depender.
 *
 * POR QUE ESTE ARQUIVO EXISTE (Issue #118)
 * ----------------------------------------
 * O cabeçalho do arquivo do front diz, com todas as letras:
 *
 *   "ESTA TELA NÃO É A BARREIRA — Ela desabilita os botões de áudio e anexo até
 *    o aceite, o que é uma cortesia de interface: quem chamar
 *    POST /chat-direto/upload por fora não passa por aqui. A barreira de
 *    verdade é do servidor."
 *
 * O front estava correto e honesto sobre os próprios limites. O que faltava era
 * a contraparte que ele pressupõe: o aceite era registrado (`POST
 * /api/moderacao/aceite-termo`) e consultável, mas nenhum middleware da rota de
 * upload o exigia.
 *
 * Publicar assim cria a APARÊNCIA de conformidade sem a substância: o sistema
 * coleta aceites com IP, data e navegador de parte das pessoas enquanto aceita
 * mídia de quem não aceitou. É pior que não ter o Termo, porque o registro
 * documenta um controle que não está em vigor. A cláusula 3 agrava: ela obtém
 * consentimento para ARMAZENAR e PROCESSAR automaticamente áudio e imagem
 * (incluindo transcrição e análise) — conteúdo enviado sem aceite é conteúdo
 * processado sem a base de consentimento que o próprio Termo estabelece.
 *
 * FALHA FECHADA — E ISSO É O CONTRÁRIO DO FRONT, DE PROPÓSITO
 * ----------------------------------------------------------
 * O front falha ABERTO (se a consulta cair, os botões continuam como estavam),
 * com o argumento de não trancar o chat da escola por uma requisição perdida.
 * No servidor o raciocínio se inverte: aqui a consulta é local ao banco, e
 * falhar aberto significa aceitar mídia sem base de consentimento. Uma
 * indisponibilidade momentânea do banco vira "não dá para enviar mídia agora",
 * não "pode enviar sem consentimento".
 *
 * Por isso os dois códigos são distintos e estáveis:
 *   403 TERMO_NAO_ACEITO   — falta o aceite (ou o aceite é de versão anterior)
 *   503 TERMO_INDISPONIVEL — não deu para verificar; tente de novo
 *
 * Códigos estáveis porque o front precisa distinguir isto do 403 de permissão,
 * que significa outra coisa e pede outra mensagem.
 */

const Usuario = require('../models/Usuario');
const logger = require('../utils/logger');
const { TERMO_VERSAO, aceiteVigente } = require('../utils/termoAudioImagem');

module.exports = async function exigirAceiteTermo(req, res, next) {
    const usuarioId = String(req.user?.id || req.user?._id || '');

    if (!usuarioId) {
        // Sem identidade não há aceite possível. Na prática o `authJWT` já
        // barrou antes; a checagem existe para o middleware não depender da
        // ordem em que foi montado.
        return res.status(401).json({
            success: false,
            error: 'Sessão não identificada.',
            code: 'NAO_AUTENTICADO',
        });
    }

    let usuario;
    try {
        usuario = await Usuario.findById(usuarioId).select('lgpdHistory').lean();
    } catch (erro) {
        logger.error('[Termo] Falha ao verificar o aceite do Termo de áudio e imagem', {
            erro: erro.message,
            action: 'termo.verificarAceite',
        });
        return res.status(503).json({
            success: false,
            error: 'Não foi possível verificar o aceite do Termo agora. Tente novamente.',
            code: 'TERMO_INDISPONIVEL',
        });
    }

    if (!aceiteVigente(usuario?.lgpdHistory)) {
        // `warn`, não `error`: é uma recusa esperada do sistema funcionando, e
        // o canal de erro existe para falha de servidor (ver Issue #109).
        logger.warn('[Termo] Envio de mídia recusado — Termo não aceito', {
            action: 'termo.recusado',
            versao: TERMO_VERSAO,
        });
        return res.status(403).json({
            success: false,
            error: 'É preciso aceitar o Termo de Uso de Áudio e Imagem antes de enviar mídia.',
            code: 'TERMO_NAO_ACEITO',
            versao: TERMO_VERSAO,
        });
    }

    return next();
};
