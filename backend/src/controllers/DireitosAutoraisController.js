/**
 * DireitosAutoraisController — catálogo de obras protegidas e bloqueio de
 * arquivo específico (Issue #509).
 *
 * Direção cadastra e bloqueia na PRÓPRIA escola; o admin atua na rede toda.
 * Toda ação vai para o AuditLog: bloquear conteúdo é decisão que alguém
 * precisa conseguir explicar depois.
 */
const AuditoriaService = require('../services/AuditoriaService');
const obs = require('../observability');
const logger = require('../utils/logger');
const direitosAutorais = require('../services/direitosAutorais');
const { findFileDoc } = require('./FileController');

function contexto(req) {
    const redeToda = String(req.user?.perfil || '').toLowerCase() === 'admin';
    return { redeToda, escolaId: redeToda ? null : req.escolaId || null };
}

function dadosDoCorpo(body = {}) {
    const texto = (valor, max) =>
        typeof valor === 'string' ? valor.trim().slice(0, max) : undefined;
    return {
        titulo: texto(body.titulo, 200),
        titular: texto(body.titular, 200),
        motivo: texto(body.motivo, 500),
        acao: body.acao === 'liberar' ? 'liberar' : 'bloquear',
    };
}

function semEscola(res) {
    return res.status(400).json({
        success: false,
        error: 'Selecione a escola antes de gerenciar direitos autorais.',
    });
}

function falha(res, rotulo, error) {
    obs.captureException(error, { tipo: `direitos_autorais.${rotulo}` });
    logger.error(`[DireitosAutorais.${rotulo}] ${error.message}`);
    return res.status(error.status || 500).json({
        success: false,
        error: error.status ? error.message : 'Erro ao processar a solicitação.',
    });
}

function resumo(obra) {
    return {
        id: String(obra._id),
        acao: obra.acao,
        midia: obra.midia,
        titulo: obra.titulo,
        titular: obra.titular,
        motivo: obra.motivo,
        escolaId: obra.escolaId,
        origemArquivoId: obra.origemArquivoId,
        criadoEm: obra.createdAt,
    };
}

// GET /api/direitos-autorais/obras
exports.listar = async (req, res) => {
    try {
        const ctx = contexto(req);
        if (!ctx.redeToda && !ctx.escolaId) return semEscola(res);
        const obras = await direitosAutorais.listarObras(ctx);
        res.json({ success: true, data: obras.map(resumo) });
    } catch (error) {
        falha(res, 'listar', error);
    }
};

// POST /api/direitos-autorais/obras  (multipart: arquivo + titulo/titular/motivo/acao)
exports.cadastrar = async (req, res) => {
    try {
        const ctx = contexto(req);
        if (!ctx.redeToda && !ctx.escolaId) return semEscola(res);
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Envie o arquivo de referência (imagem ou áudio).',
            });
        }

        const dados = dadosDoCorpo(req.body);
        const { obra, arquivosBloqueados } = await direitosAutorais.cadastrarObra({
            buffer: req.file.buffer,
            mimetype: req.file.mimetype,
            dados,
            escolaId: ctx.escolaId,
            usuario: req.user,
        });

        await AuditoriaService.log({
            req,
            acao:
                dados.acao === 'liberar'
                    ? 'LIBERAR_OBRA_DIREITO_AUTORAL'
                    : 'CADASTRAR_OBRA_PROTEGIDA',
            recurso: 'DireitosAutorais',
            recursoId: String(obra._id),
            detalhes: {
                valorNovo: { ...resumo(obra), arquivosBloqueados },
                descricao: `escola ${ctx.escolaId || 'rede'}`,
            },
        });

        res.status(201).json({ success: true, data: { ...resumo(obra), arquivosBloqueados } });
    } catch (error) {
        falha(res, 'cadastrar', error);
    }
};

// POST /api/direitos-autorais/arquivos/:id/bloquear
exports.bloquearArquivo = async (req, res) => {
    try {
        const ctx = contexto(req);
        if (!ctx.redeToda && !ctx.escolaId) return semEscola(res);

        const arquivoDoc = await findFileDoc(req.params.id);
        // Mesma resposta para "não existe" e "é de outra escola": um 403 aqui
        // confirmaria a existência do id no bucket de outro tenant.
        const deOutraEscola =
            !ctx.redeToda && String(arquivoDoc?.metadata?.escolaId || '') !== String(ctx.escolaId);
        if (!arquivoDoc || deOutraEscola) {
            return res.status(404).json({ success: false, error: 'Arquivo não encontrado.' });
        }

        const resultado = await direitosAutorais.bloquearArquivoArmazenado({
            arquivoDoc,
            dados: dadosDoCorpo(req.body),
            escolaId: ctx.escolaId,
            usuario: req.user,
        });
        if (!resultado) {
            return res
                .status(400)
                .json({ success: false, error: 'Só imagem ou áudio podem ser bloqueados.' });
        }

        await AuditoriaService.log({
            req,
            acao: 'BLOQUEAR_ARQUIVO_DIREITO_AUTORAL',
            recurso: 'DireitosAutorais',
            recursoId: String(arquivoDoc._id),
            detalhes: {
                valorNovo: {
                    ...resumo(resultado.obra),
                    arquivosBloqueados: resultado.arquivosBloqueados,
                },
                descricao: `escola ${ctx.escolaId || 'rede'}`,
            },
        });

        res.status(201).json({
            success: true,
            data: { ...resumo(resultado.obra), arquivosBloqueados: resultado.arquivosBloqueados },
        });
    } catch (error) {
        falha(res, 'bloquearArquivo', error);
    }
};

// DELETE /api/direitos-autorais/obras/:id
exports.remover = async (req, res) => {
    try {
        const ctx = contexto(req);
        if (!ctx.redeToda && !ctx.escolaId) return semEscola(res);

        const obra = await direitosAutorais.removerObra(req.params.id, ctx);
        if (!obra) return res.status(404).json({ success: false, error: 'Obra não encontrada.' });

        await AuditoriaService.log({
            req,
            acao: 'REMOVER_OBRA_PROTEGIDA',
            recurso: 'DireitosAutorais',
            recursoId: String(obra._id),
            detalhes: {
                valorAnterior: resumo(obra),
                descricao: `escola ${ctx.escolaId || 'rede'}`,
            },
        });

        res.json({ success: true, data: resumo(obra) });
    } catch (error) {
        falha(res, 'remover', error);
    }
};
