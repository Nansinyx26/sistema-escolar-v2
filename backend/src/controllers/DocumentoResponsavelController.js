const crypto = require('node:crypto');

/** SHA-256 do conteúdo: identidade do arquivo guardado (Issue #399). */
function hashDoArquivo(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}
const mongoose = require('mongoose');
const DocumentoResponsavel = require('../models/DocumentoResponsavel');
const Aluno = require('../models/Aluno');
const _Usuario = require('../models/Usuario');
const { saveToGridFS, getFileStream, deleteFile } = require('../utils/gridfs');
const { validarAssinatura } = require('../utils/assinaturaArquivo');
const { emitirParaPerfis, emitirParaUsuario } = require('../utils/realtime');
const assertAcessoAoAluno = require('../middleware/assertAcessoAoAluno');
const escapeRegex = require('../utils/escapeRegex');
const logger = require('../utils/logger');
const { logAction } = require('../utils/auditHelper');

const PERFIS_GESTAO = ['admin', 'diretor', 'secretaria'];

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

        // Escola e vínculo, para qualquer perfil (Issue #397). Antes, só o
        // responsável era conferido: a gestão anexava documento a aluno de
        // qualquer escola da rede.
        const acesso = await assertAcessoAoAluno(req, String(aluno._id || aluno.id), { aluno });
        if (!acesso.ok) {
            return res.status(acesso.status).json({ success: false, error: acesso.error });
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
                hash: hashDoArquivo(file.buffer),
                enviadoPor: usuarioId,
                enviadoEm: new Date(),
            },
        });

        await novoDoc.save();

        await logAction(req, 'DOCUMENTO_RESPONSAVEL_ENVIADO', 'Documentos', {
            recursoId: String(novoDoc._id),
            valorNovo: { alunoId: String(aluno._id), hash: novoDoc.arquivo.hash },
            descricao: `Documento ${novoDoc._id} enviado para o aluno ${aluno._id}.`,
        });

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

        // Escola e vínculo do aluno do documento (Issue #397).
        const acesso = await assertAcessoAoAluno(req, String(doc.alunoId));
        if (!acesso.ok) {
            return res.status(acesso.status).json({ success: false, error: acesso.error });
        }

        // Só quem enviou substitui o próprio arquivo (Issue #399). A gestão
        // muda status e registra parecer; trocar o arquivo da família faria o
        // registro continuar no nome do responsável com outro conteúdo.
        if (String(doc.responsavelId) !== usuarioId) {
            return res.status(403).json({
                success: false,
                codigo: 'SUBSTITUICAO_SO_DE_QUEM_ENVIOU',
                error: 'Apenas quem enviou o documento pode substituí-lo. A escola pode registrar parecer e mudar o status.',
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

        // A versão anterior NÃO é apagada (Issue #399): ela vira histórico.
        const versaoAnterior = doc.arquivo
            ? {
                  nomeOriginal: doc.arquivo.nomeOriginal,
                  storageId: doc.arquivo.storageId,
                  mimeType: doc.arquivo.mimeType,
                  tamanho: doc.arquivo.tamanho,
                  hash: doc.arquivo.hash,
                  enviadoPor: doc.arquivo.enviadoPor,
                  enviadoEm: doc.arquivo.enviadoEm || doc.dataEnvio,
                  substituidoEm: new Date(),
              }
            : null;

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
        if (versaoAnterior) doc.versoes = [...(doc.versoes || []), versaoAnterior];
        doc.arquivo = {
            nomeOriginal: file.originalname,
            url: `/api/documentos-responsaveis/${storageId}/visualizar`,
            storageId: String(storageId),
            mimeType: file.mimetype,
            tamanho: file.size || file.buffer.length,
            hash: hashDoArquivo(file.buffer),
            enviadoPor: usuarioId,
            enviadoEm: new Date(),
        };
        doc.ultimaAtualizacao = new Date();
        doc.status = 'Enviado';
        if (req.body.observacoes !== undefined) {
            doc.observacoes = String(req.body.observacoes).trim();
        }

        await doc.save();

        await logAction(req, 'DOCUMENTO_RESPONSAVEL_SUBSTITUIDO', 'Documentos', {
            recursoId: String(doc._id),
            valorAnterior: { hash: versaoAnterior?.hash, versoes: (doc.versoes || []).length - 1 },
            valorNovo: { hash: doc.arquivo.hash, versoes: (doc.versoes || []).length },
            descricao: `Documento ${doc._id} substituído; versão anterior preservada.`,
        });

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

        // Escola e vínculo, para qualquer perfil (Issue #397).
        const acesso = await assertAcessoAoAluno(req, String(aluno._id || aluno.id), { aluno });
        if (!acesso.ok) {
            return res.status(acesso.status).json({ success: false, error: acesso.error });
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

    // A busca alcança também as VERSÕES anteriores (Issue #399): a versão
    // substituída continua existindo e precisa continuar acessível a quem
    // pode ver o documento.
    const query = mongoose.Types.ObjectId.isValid(idOuStorageId)
        ? {
              $or: [
                  { _id: idOuStorageId },
                  { 'arquivo.storageId': idOuStorageId },
                  { 'versoes.storageId': idOuStorageId },
              ],
          }
        : {
              $or: [{ 'arquivo.storageId': idOuStorageId }, { 'versoes.storageId': idOuStorageId }],
          };

    const doc = await DocumentoResponsavel.findOne(query).lean();
    if (!doc) {
        return { ok: false, status: 404, error: 'Documento não encontrado.' };
    }

    // Escola e vínculo do aluno do documento, para qualquer perfil
    // (Issue #397): a gestão de uma escola abria documento assinado de aluno
    // de outra escola da rede.
    const acesso = await assertAcessoAoAluno(req, String(doc.alunoId));
    if (!acesso.ok) {
        return { ok: false, status: acesso.status, error: acesso.error };
    }

    // Responsável vê só o que ele mesmo enviou.
    if (perfil === 'responsavel') {
        const usuarioId = String(req.user?.id || req.user?._id || '');
        if (String(doc.responsavelId) !== usuarioId) {
            return { ok: false, status: 403, error: 'Acesso negado a este documento.' };
        }
    }

    // Qual arquivo servir: o atual, ou a versão pedida pelo storageId.
    const versao = (doc.versoes || []).find((v) => String(v.storageId) === String(idOuStorageId));
    return { ok: true, doc, arquivo: versao || doc.arquivo, ehVersaoAnterior: !!versao };
}

/**
 * A tela "Autorizações dos Pais" abre o arquivo num <iframe> da própria
 * aplicação. A política global (`frame-ancestors 'none'` + `X-Frame-Options:
 * DENY`, em app.js) bloqueava esse iframe, e o preview ficava em branco. Só
 * nesta resposta o enquadramento passa a valer para a MESMA origem: um site de
 * fora continua sem poder enquadrar. O resto da CSP fica como está. O upload
 * só aceita PDF, JPG e PNG (middleware/uploadDocument.js), e as respostas de
 * erro são JSON, então nada aqui executa script.
 */
function permitirEnquadramentoNaMesmaOrigem(res) {
    const politica = String(res.getHeader('Content-Security-Policy') || '');
    res.set(
        'Content-Security-Policy',
        /frame-ancestors[^;]*/.test(politica)
            ? politica.replace(/frame-ancestors[^;]*/, "frame-ancestors 'self'")
            : `${politica ? `${politica};` : ''}frame-ancestors 'self'`
    );
    res.set('X-Frame-Options', 'SAMEORIGIN');
}

/**
 * GET /api/documentos-responsaveis/:id/versoes
 * Histórico do documento: a versão atual e as anteriores, com hash e datas.
 * Serve para a escola conferir o que valia em cada momento (Issue #399).
 */
exports.listarVersoes = async (req, res) => {
    try {
        const auth = await localizarEAutorizar(req, req.params.id);
        if (!auth.ok) {
            return res.status(auth.status).json({ success: false, error: auth.error });
        }
        const { doc } = auth;
        const descrever = (a, atual) => ({
            atual,
            nomeOriginal: a?.nomeOriginal,
            storageId: a?.storageId,
            hash: a?.hash || null,
            tamanho: a?.tamanho,
            enviadoEm: a?.enviadoEm || doc.dataEnvio,
            substituidoEm: a?.substituidoEm || null,
        });
        return res.json({
            success: true,
            data: [
                descrever(doc.arquivo, true),
                ...(doc.versoes || [])
                    .slice()
                    .reverse()
                    .map((v) => descrever(v, false)),
            ],
        });
    } catch (error) {
        logger.error(`[DocumentoResponsavel.listarVersoes] ${error.message}`);
        return res.status(500).json({ success: false, error: 'Erro ao listar versões.' });
    }
};

/**
 * GET /api/documentos-responsaveis/:id/visualizar
 * Serve o arquivo em modo inline (preview sem forçar download).
 */
/** Quem abriu o documento assinado, e quando (Issue #399). */
async function registrarLeitura(req, doc, acao) {
    await logAction(req, acao, 'Documentos', {
        recursoId: String(doc._id),
        valorNovo: { alunoId: String(doc.alunoId) },
        descricao: `Documento ${doc._id} acessado (${acao}).`,
    });
}

exports.visualizarArquivo = async (req, res) => {
    // Antes de tudo: o erro (403/404) também precisa abrir no iframe, para a
    // tela ler a mensagem em vez de receber a página de bloqueio do navegador.
    permitirEnquadramentoNaMesmaOrigem(res);
    try {
        const { id } = req.params;
        const auth = await localizarEAutorizar(req, id);
        if (!auth.ok) {
            return res.status(auth.status).json({ success: false, error: auth.error });
        }

        const { doc, arquivo } = auth;
        const storageId = arquivo.storageId;
        const mimeType = arquivo.mimeType || 'application/pdf';
        const nomeOriginal = arquivo.nomeOriginal || 'documento.pdf';
        await registrarLeitura(req, doc, 'DOCUMENTO_RESPONSAVEL_VISUALIZADO');

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

        const { doc, arquivo } = auth;
        const storageId = arquivo.storageId;
        const mimeType = arquivo.mimeType || 'application/pdf';
        const nomeOriginal = arquivo.nomeOriginal || 'documento.pdf';
        await registrarLeitura(req, doc, 'DOCUMENTO_RESPONSAVEL_BAIXADO');

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

        // Escola e vínculo do aluno do documento (Issue #397).
        const acesso = await assertAcessoAoAluno(req, String(doc.alunoId));
        if (!acesso.ok) {
            return res.status(acesso.status).json({ success: false, error: acesso.error });
        }

        if (status && ['Enviado', 'Em Análise', 'Conferido', 'Substituído'].includes(status)) {
            doc.status = status;
        }
        // O parecer da gestão fica separado do que a família escreveu.
        if (observacoes !== undefined) {
            doc.parecerGestao = {
                texto: String(observacoes).trim(),
                autorId: String(req.user?.id || req.user?._id || ''),
                em: new Date(),
            };
        }
        doc.ultimaAtualizacao = new Date();
        await doc.save();

        await logAction(req, 'DOCUMENTO_RESPONSAVEL_STATUS', 'Documentos', {
            recursoId: String(doc._id),
            valorNovo: { status: doc.status, parecer: observacoes !== undefined },
            descricao: `Documento ${doc._id}: status ${doc.status}.`,
        });

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
