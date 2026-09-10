const crypto = require('node:crypto');
const mongoose = require('mongoose');
const DocumentoResponsavel = require('../models/DocumentoResponsavel');
const Aluno = require('../models/Aluno');
const _Usuario = require('../models/Usuario');
const { saveToGridFS, getFileStream, deleteFile } = require('../utils/gridfs');
const { validarAssinatura } = require('../utils/assinaturaArquivo');
const { emitirParaPerfis, emitirParaUsuario } = require('../utils/realtime');
const escapeRegex = require('../utils/escapeRegex');
const logger = require('../utils/logger');

const PERFIS_GESTAO = ['admin', 'diretor', 'secretaria'];

function emailRegexExato(email) {
    return new RegExp(`^${escapeRegex(String(email || ''))}$`, 'i');
}

async function verifyOwnership(alunoId, email, user = null) {
    if (user && Array.isArray(user.alunoIds)) {
        const idStr = String(alunoId);
        if (user.alunoIds.some((id) => String(id) === idStr)) {
            return true;
        }
    }
    if (!email) return false;
    const emailRegex = emailRegexExato(email);
    const aluno = await Aluno.findOne({
        $and: [
            { $or: [{ _id: alunoId }, { id: alunoId }] },
            {
                $or: [
                    { responsavel: emailRegex },
                    { 'responsavelDados.email': emailRegex },
                    { 'responsaveis.email': emailRegex },
                ],
            },
        ],
    }).lean();
    return !!aluno;
}

async function carregarAluno(alunoId) {
    const or = [{ id: alunoId }];
    if (mongoose.Types.ObjectId.isValid(alunoId)) {
        or.push({ _id: alunoId });
    }
    return Aluno.findOne({ $or: or }).lean();
}

/**
 * POST /api/documentos-responsaveis/upload
 * Envia um documento assinado pelo responsável.
 */
exports.uploadDocumento = async (req, res) => {
    try {
        const perfil = String(req.user?.perfil || '').toLowerCase();
        if (perfil === 'professor') {
            return res.status(403).json({
                success: false,
                error: 'Professores não possuem acesso a esta funcionalidade.',
            });
        }

        const { alunoId, tipoDocumento, nomeDocumento, observacoes } = req.body;
        const file = req.file;

        if (!alunoId) {
            return res.status(400).json({ success: false, error: 'ID do aluno é obrigatório.' });
        }
        if (!tipoDocumento || !String(tipoDocumento).trim()) {
            return res
                .status(400)
                .json({ success: false, error: 'Tipo do documento é obrigatório.' });
        }
        if (!nomeDocumento || !String(nomeDocumento).trim()) {
            return res
                .status(400)
                .json({ success: false, error: 'Nome do documento é obrigatório.' });
        }
        if (!file) {
            return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado.' });
        }

        // Validação de segurança: apenas o responsável pelo aluno ou gestão
        const aluno = await carregarAluno(alunoId);
        if (!aluno) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }

        if (perfil === 'responsavel') {
            const isOwner = await verifyOwnership(aluno._id || aluno.id, req.user.email, req.user);
            if (!isOwner) {
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado: o aluno informado não está vinculado a este responsável.',
                });
            }
        }

        // Validação do arquivo (tamanho, formato e assinatura binária)
        const allowedMimes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
        if (!allowedMimes.includes(file.mimetype)) {
            return res.status(400).json({
                success: false,
                error: 'Formato inválido. Apenas PDF, JPG e PNG são permitidos.',
            });
        }
        if (file.size > 10 * 1024 * 1024) {
            return res.status(400).json({
                success: false,
                error: 'Arquivo excede o limite máximo permitido de 10 MB.',
            });
        }

        const veredito = validarAssinatura(file.buffer, file.mimetype);
        if (!veredito.ok) {
            return res
                .status(400)
                .json({ success: false, error: `Arquivo rejeitado: ${veredito.motivo}` });
        }

        // Grava no GridFS
        const ext =
            file.mimetype === 'application/pdf'
                ? '.pdf'
                : file.mimetype.includes('png')
                  ? '.png'
                  : '.jpg';
        const filename = crypto.randomBytes(16).toString('hex') + ext;
        const usuarioId = String(req.user?.id || req.user?._id || '');
        const escolaId = req.escolaId
            ? String(req.escolaId)
            : aluno.escolaId
              ? String(aluno.escolaId)
              : undefined;

        const storageId = await saveToGridFS(file.buffer, filename, file.mimetype, {
            usuarioId,
            alunoId: String(aluno._id || aluno.id),
            escolaId,
            type: 'documento_responsavel',
        });

        const alunoNomeCompleto = [aluno.nome, aluno.sobrenome].filter(Boolean).join(' ');
        const responsavelNome = req.user?.nome || req.user?.email || 'Responsável';
        const turma = aluno.turma || aluno.turmaId || 'Sem Turma';

        const novoDoc = new DocumentoResponsavel({
            alunoId: aluno._id || aluno.id,
            alunoNome: alunoNomeCompleto,
            responsavelId: usuarioId,
            responsavelNome: responsavelNome,
            turmaId: aluno.turmaId || aluno.turma,
            turmaNome: turma,
            tipoDocumento: String(tipoDocumento).trim(),
            nomeDocumento: String(nomeDocumento).trim(),
            observacoes: observacoes ? String(observacoes).trim() : '',
            status: 'Enviado',
            dataEnvio: new Date(),
            ultimaAtualizacao: new Date(),
            escolaId,
            arquivo: {
                nomeOriginal: file.originalname,
                url: `/api/documentos-responsaveis/${storageId}/visualizar`,
                storageId: String(storageId),
                mimeType: file.mimetype,
                tamanho: file.size || file.buffer.length,
            },
        });

        await novoDoc.save();

        // Emite atualização em tempo real para Secretaria e Direção
        emitirParaPerfis(
            escolaId,
            ['secretaria', 'diretor', 'admin'],
            'documento_responsavel:novo',
            novoDoc
        );

        return res.status(201).json({ success: true, data: novoDoc });
    } catch (error) {
        logger.error(`[DocumentoResponsavel.upload] ${error.message}`);
        return res
            .status(500)
            .json({ success: false, error: error.message || 'Erro ao enviar documento.' });
    }
};

/**
 * PUT /api/documentos-responsaveis/:id/substituir
 * Substitui o arquivo de um documento já enviado mantendo o vínculo com o aluno.
 */
exports.substituirDocumento = async (req, res) => {
    try {
        const perfil = String(req.user?.perfil || '').toLowerCase();
        if (perfil === 'professor') {
            return res.status(403).json({
                success: false,
                error: 'Professores não possuem acesso a esta funcionalidade.',
            });
        }

        const { id } = req.params;
        const file = req.file;

        if (!file) {
            return res
                .status(400)
                .json({ success: false, error: 'Nenhum novo arquivo enviado para substituição.' });
        }

        const doc = await DocumentoResponsavel.findById(id);
        if (!doc) {
            return res.status(404).json({ success: false, error: 'Documento não encontrado.' });
        }

        const usuarioId = String(req.user?.id || req.user?._id || '');

        // Segurança: apenas o próprio responsável que enviou ou equipe gestora
        if (perfil === 'responsavel' && String(doc.responsavelId) !== usuarioId) {
            return res.status(403).json({
                success: false,
                error: 'Apenas o responsável que enviou o documento pode substituí-lo.',
            });
        }

        // Validação do novo arquivo
        const allowedMimes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
        if (!allowedMimes.includes(file.mimetype)) {
            return res.status(400).json({
                success: false,
                error: 'Formato inválido. Apenas PDF, JPG e PNG são permitidos.',
            });
        }
        if (file.size > 10 * 1024 * 1024) {
            return res
                .status(400)
                .json({ success: false, error: 'Arquivo excede o limite de 10 MB.' });
        }

        const veredito = validarAssinatura(file.buffer, file.mimetype);
        if (!veredito.ok) {
            return res
                .status(400)
                .json({ success: false, error: `Arquivo rejeitado: ${veredito.motivo}` });
        }

        // Deleta arquivo anterior do GridFS se existir
        if (doc.arquivo?.storageId) {
            deleteFile(doc.arquivo.storageId).catch((err) => {
                logger.warn(
                    `[DocumentoResponsavel.substituir] Falha ao deletar arquivo antigo: ${err.message}`
                );
            });
        }

        // Salva novo arquivo no GridFS
        const ext =
            file.mimetype === 'application/pdf'
                ? '.pdf'
                : file.mimetype.includes('png')
                  ? '.png'
                  : '.jpg';
        const filename = crypto.randomBytes(16).toString('hex') + ext;
        const storageId = await saveToGridFS(file.buffer, filename, file.mimetype, {
            usuarioId,
            alunoId: String(doc.alunoId),
            escolaId: doc.escolaId,
            type: 'documento_responsavel',
        });

        // Atualiza campos mantendo o vínculo com o aluno e responsável
        doc.arquivo = {
            nomeOriginal: file.originalname,
            url: `/api/documentos-responsaveis/${storageId}/visualizar`,
            storageId: String(storageId),
            mimeType: file.mimetype,
            tamanho: file.size || file.buffer.length,
        };
        doc.ultimaAtualizacao = new Date();
        doc.status = 'Enviado';
        if (req.body.observacoes !== undefined) {
            doc.observacoes = String(req.body.observacoes).trim();
        }

        await doc.save();

        // Emite atualização em tempo real
        emitirParaPerfis(
            doc.escolaId,
            ['secretaria', 'diretor', 'admin'],
            'documento_responsavel:atualizado',
            doc
        );
        emitirParaUsuario(doc.responsavelId, 'documento_responsavel:atualizado', doc);

        return res.json({ success: true, data: doc });
    } catch (error) {
        logger.error(`[DocumentoResponsavel.substituir] ${error.message}`);
        return res
            .status(500)
            .json({ success: false, error: error.message || 'Erro ao substituir documento.' });
    }
};

/**
 * GET /api/documentos-responsaveis/meus
 * Retorna os documentos enviados pelo responsável logado.
 */
exports.listarMeusDocumentos = async (req, res) => {
    try {
        const usuarioId = String(req.user?.id || req.user?._id || '');
        if (!usuarioId) {
            return res.status(401).json({ success: false, error: 'Não autenticado.' });
        }

        const query = { responsavelId: usuarioId };
        if (req.query.alunoId) {
            query.alunoId = req.query.alunoId;
        }

        const documentos = await DocumentoResponsavel.find(query).sort({ dataEnvio: -1 }).lean();
        return res.json({ success: true, data: documentos });
    } catch (error) {
        logger.error(`[DocumentoResponsavel.listarMeus] ${error.message}`);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /api/documentos-responsaveis/aluno/:alunoId
 * Retorna os documentos do aluno e suas autorizações escolares.
 */
exports.listarPorAluno = async (req, res) => {
    try {
        const perfil = String(req.user?.perfil || '').toLowerCase();
        if (perfil === 'professor') {
            return res.status(403).json({
                success: false,
                error: 'Professores não possuem acesso a esta funcionalidade.',
            });
        }

        const { alunoId } = req.params;
        const aluno = await carregarAluno(alunoId);
        if (!aluno) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }

        // Se for responsável, garante que o aluno é dele
        if (perfil === 'responsavel') {
            const isOwner = await verifyOwnership(aluno._id || aluno.id, req.user.email);
            if (!isOwner) {
                return res
                    .status(403)
                    .json({ success: false, error: 'Acesso negado a este aluno.' });
            }
        }

        const idAluno = aluno._id || aluno.id;
        const query = {
            $or: [{ alunoId: idAluno }, { alunoId: String(idAluno) }, { alunoId: alunoId }],
        };

        const documentos = await DocumentoResponsavel.find(query).sort({ dataEnvio: -1 }).lean();

        return res.json({
            success: true,
            data: {
                aluno: {
                    id: idAluno,
                    nome: [aluno.nome, aluno.sobrenome].filter(Boolean).join(' '),
                    matricula: aluno.matricula,
                    turma: aluno.turma || aluno.turmaId,
                    autorizacoesEscolares: aluno.autorizacoesEscolares || {},
                    dataResposta: aluno.updatedAt || aluno.dataEnvio || null,
                },
                documentos,
            },
        });
    } catch (error) {
        logger.error(`[DocumentoResponsavel.listarPorAluno] ${error.message}`);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /api/documentos-responsaveis
 * Listagem para Secretaria e Direção com filtros e pesquisa.
 */
exports.listarTodos = async (req, res) => {
    try {
        const perfil = String(req.user?.perfil || '').toLowerCase();
        if (!PERFIS_GESTAO.includes(perfil)) {
            return res
                .status(403)
                .json({ success: false, error: 'Acesso restrito à Secretaria e Direção.' });
        }

        const {
            search,
            turma,
            turmaId,
            tipoDocumento,
            status,
            dataInicio,
            dataFim,
            responsavelId,
            alunoId,
        } = req.query;
        const filter = {};

        if (req.escolaId) {
            filter.escolaId = String(req.escolaId);
        }

        if (turmaId || turma) {
            const t = turmaId || turma;
            filter.$or = [{ turmaId: t }, { turmaNome: new RegExp(escapeRegex(t), 'i') }];
        }

        if (tipoDocumento) {
            filter.tipoDocumento = tipoDocumento;
        }

        if (status) {
            filter.status = status;
        }

        if (responsavelId) {
            filter.responsavelId = responsavelId;
        }

        if (alunoId) {
            filter.alunoId = alunoId;
        }

        if (dataInicio || dataFim) {
            filter.dataEnvio = {};
            if (dataInicio) {
                filter.dataEnvio.$gte = new Date(dataInicio);
            }
            if (dataFim) {
                const ate = new Date(dataFim);
                ate.setHours(23, 59, 59, 999);
                filter.dataEnvio.$lte = ate;
            }
        }

        if (search && String(search).trim()) {
            const rx = new RegExp(escapeRegex(String(search).trim()), 'i');
            filter.$or = [
                { alunoNome: rx },
                { responsavelNome: rx },
                { tipoDocumento: rx },
                { nomeDocumento: rx },
                { turmaNome: rx },
            ];
        }

        const documentos = await DocumentoResponsavel.find(filter).sort({ dataEnvio: -1 }).lean();
        return res.json({ success: true, data: documentos });
    } catch (error) {
        logger.error(`[DocumentoResponsavel.listarTodos] ${error.message}`);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Localiza documento e verifica autorização de acesso ao arquivo.
 */
async function localizarEAutorizar(req, idOuStorageId) {
    const perfil = String(req.user?.perfil || '').toLowerCase();
    if (perfil === 'professor') {
        return { ok: false, status: 403, error: 'Professores não possuem permissão.' };
    }

    const query = mongoose.Types.ObjectId.isValid(idOuStorageId)
        ? { $or: [{ _id: idOuStorageId }, { 'arquivo.storageId': idOuStorageId }] }
        : { 'arquivo.storageId': idOuStorageId };

    const doc = await DocumentoResponsavel.findOne(query).lean();
    if (!doc) {
        return { ok: false, status: 404, error: 'Documento não encontrado.' };
    }

    // Se for responsável, verifica se é dele
    if (perfil === 'responsavel') {
        const usuarioId = String(req.user?.id || req.user?._id || '');
        if (String(doc.responsavelId) !== usuarioId) {
            return { ok: false, status: 403, error: 'Acesso negado a este documento.' };
        }
    }

    return { ok: true, doc };
}

/**
 * GET /api/documentos-responsaveis/:id/visualizar
 * Serve o arquivo em modo inline (preview sem forçar download).
 */
exports.visualizarArquivo = async (req, res) => {
    try {
        const { id } = req.params;
        const auth = await localizarEAutorizar(req, id);
        if (!auth.ok) {
            return res.status(auth.status).json({ success: false, error: auth.error });
        }

        const { doc } = auth;
        const storageId = doc.arquivo.storageId;
        const mimeType = doc.arquivo.mimeType || 'application/pdf';
        const nomeOriginal = doc.arquivo.nomeOriginal || 'documento.pdf';

        res.set('Content-Type', mimeType);
        res.set('Content-Disposition', `inline; filename="${encodeURIComponent(nomeOriginal)}"`);
        res.set('Cache-Control', 'private, max-age=3600');

        const stream = getFileStream(storageId);
        stream.on('error', (err) => {
            logger.error(`[DocumentoResponsavel.visualizar] Erro no stream: ${err.message}`);
            if (!res.headersSent) {
                res.status(404).json({
                    success: false,
                    error: 'Arquivo não encontrado no armazenamento.',
                });
            } else {
                res.end();
            }
        });
        stream.pipe(res);
    } catch (error) {
        logger.error(`[DocumentoResponsavel.visualizar] ${error.message}`);
        return res.status(500).json({ success: false, error: 'Erro ao visualizar arquivo.' });
    }
};

/**
 * GET /api/documentos-responsaveis/:id/download
 * Serve o arquivo como download (anexo).
 */
exports.baixarArquivo = async (req, res) => {
    try {
        const { id } = req.params;
        const auth = await localizarEAutorizar(req, id);
        if (!auth.ok) {
            return res.status(auth.status).json({ success: false, error: auth.error });
        }

        const { doc } = auth;
        const storageId = doc.arquivo.storageId;
        const mimeType = doc.arquivo.mimeType || 'application/pdf';
        const nomeOriginal = doc.arquivo.nomeOriginal || 'documento.pdf';

        res.set('Content-Type', mimeType);
        res.set(
            'Content-Disposition',
            `attachment; filename="${encodeURIComponent(nomeOriginal)}"`
        );
        res.set('Cache-Control', 'private, max-age=3600');

        const stream = getFileStream(storageId);
        stream.on('error', (err) => {
            logger.error(`[DocumentoResponsavel.baixar] Erro no stream: ${err.message}`);
            if (!res.headersSent) {
                res.status(404).json({ success: false, error: 'Arquivo não encontrado.' });
            } else {
                res.end();
            }
        });
        stream.pipe(res);
    } catch (error) {
        logger.error(`[DocumentoResponsavel.baixar] ${error.message}`);
        return res.status(500).json({ success: false, error: 'Erro ao baixar arquivo.' });
    }
};

/**
 * PATCH /api/documentos-responsaveis/:id/status
 * Atualiza status do documento (Conferido, Em Análise, etc.) — Secretaria / Direção.
 */
exports.atualizarStatus = async (req, res) => {
    try {
        const perfil = String(req.user?.perfil || '').toLowerCase();
        if (!PERFIS_GESTAO.includes(perfil)) {
            return res.status(403).json({
                success: false,
                error: 'Apenas a Secretaria e Direção podem alterar o status.',
            });
        }

        const { id } = req.params;
        const { status, observacoes } = req.body;

        const doc = await DocumentoResponsavel.findById(id);
        if (!doc) {
            return res.status(404).json({ success: false, error: 'Documento não encontrado.' });
        }

        if (status && ['Enviado', 'Em Análise', 'Conferido', 'Substituído'].includes(status)) {
            doc.status = status;
        }
        if (observacoes !== undefined) {
            doc.observacoes = String(observacoes).trim();
        }
        doc.ultimaAtualizacao = new Date();
        await doc.save();

        // Notifica o responsável e as equipes
        emitirParaUsuario(doc.responsavelId, 'documento_responsavel:status', doc);
        emitirParaPerfis(
            doc.escolaId,
            ['secretaria', 'diretor', 'admin'],
            'documento_responsavel:atualizado',
            doc
        );

        return res.json({ success: true, data: doc });
    } catch (error) {
        logger.error(`[DocumentoResponsavel.atualizarStatus] ${error.message}`);
        return res.status(500).json({ success: false, error: error.message });
    }
};
