const { getFileStream } = require('../utils/gridfs');
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');
const assertAcessoAoAluno = require('../middleware/assertAcessoAoAluno');

const PERFIS_GESTAO = ['admin', 'diretor', 'secretaria'];

/**
 * Localiza os metadados do arquivo no bucket 'uploads' por ObjectId ou filename.
 * Retorna null se não existir.
 */
async function findFileDoc(fileId) {
    const bucket = new GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
    let query;
    if (mongoose.Types.ObjectId.isValid(fileId)) {
        query = { $or: [{ _id: new mongoose.Types.ObjectId(fileId) }, { filename: fileId }] };
    } else {
        query = { filename: fileId };
    }
    const docs = await bucket.find(query).limit(1).toArray();
    return docs[0] || null;
}

function streamFile(res, fileDoc, cacheControl = 'private, max-age=3600') {
    res.set('Content-Type', fileDoc.contentType || 'image/webp');
    // 'private' por padrão: respostas autenticadas não podem ser cacheadas
    // por proxies compartilhados e servidas a outro usuário.
    res.set('Cache-Control', cacheControl);
    const stream = getFileStream(String(fileDoc._id));
    stream.on('error', () => {
        if (!res.headersSent) res.status(404).json({ success: false, error: 'Arquivo não encontrado' });
        else res.end();
    });
    stream.pipe(res);
}

/**
 * Autoriza o download de um arquivo do GridFS.
 *
 * O bucket 'uploads' guarda RG/CPF/comprovantes enviados pelos responsáveis.
 * Antes bastava estar logado: os gridfsId vazavam na ficha do aluno e qualquer
 * conta baixava o documento de identidade de qualquer criança.
 *
 * A decisão usa `metadata` gravado no upload:
 *   - metadata.alunoId  → mesma regra de acesso ao aluno;
 *   - metadata.usuarioId→ só o dono ou a gestão;
 *   - metadata.escolaId → precisa ser a escola ativa.
 * Arquivos legados (sem metadata) seguem a regra do tipo: imagens liberadas a
 * qualquer autenticado, não-imagens restritas à gestão.
 */
async function autorizarArquivo(req, fileDoc) {
    const perfil = String(req.user?.perfil || '').toLowerCase();
    if (perfil === 'admin') return { ok: true };

    const meta = fileDoc.metadata || {};

    // Escola: nunca cruza a fronteira do tenant
    if (meta.escolaId && req.escolaId && String(meta.escolaId) !== String(req.escolaId)) {
        return { ok: false, status: 403, error: 'Arquivo de outra escola.' };
    }

    if (meta.alunoId) {
        const acesso = await assertAcessoAoAluno(req, String(meta.alunoId));
        if (!acesso.ok) return { ok: false, status: 403, error: 'Acesso negado a este documento.' };
        return { ok: true };
    }

    if (meta.usuarioId) {
        const meuId = String(req.user?.id || req.user?._id || '');
        if (String(meta.usuarioId) === meuId || PERFIS_GESTAO.includes(perfil)) return { ok: true };
        return { ok: false, status: 403, error: 'Acesso negado a este arquivo.' };
    }

    // Legado sem metadata: documentos (PDF etc.) só para a equipe gestora
    const contentType = fileDoc.contentType || '';
    if (!contentType.startsWith('image/') && !PERFIS_GESTAO.includes(perfil)) {
        return { ok: false, status: 403, error: 'Acesso negado a este documento.' };
    }
    return { ok: true };
}

/**
 * Serve um arquivo do GridFS (rotas autenticadas — fotos e documentos).
 */
exports.serveFile = async (req, res) => {
    try {
        const fileDoc = await findFileDoc(req.params.id);
        if (!fileDoc) return res.status(404).json({ success: false, error: 'Arquivo não encontrado' });

        const permissao = await autorizarArquivo(req, fileDoc);
        if (!permissao.ok) {
            return res.status(permissao.status).json({ success: false, error: permissao.error });
        }

        streamFile(res, fileDoc);
    } catch (error) {
        console.error('Erro no serveFile:', error);
        res.status(500).json({ success: false, error: 'Erro ao servir arquivo' });
    }
};

/**
 * Serve APENAS imagens (rota pública /api/files/:id, usada por <img> de avatar).
 * O bucket 'uploads' também guarda documentos de alunos (PDF etc.) — esses
 * exigem autenticação e só saem pelas rotas com authJWT.
 */
exports.servePublicImage = async (req, res) => {
    try {
        const fileDoc = await findFileDoc(req.params.id);
        if (!fileDoc) return res.status(404).json({ success: false, error: 'Arquivo não encontrado' });

        const contentType = fileDoc.contentType || '';
        if (!contentType.startsWith('image/')) {
            return res.status(403).json({ success: false, error: 'Este arquivo requer autenticação.' });
        }

        // Documentos de aluno enviados como imagem (foto do RG, por exemplo)
        // NUNCA saem pela rota pública, mesmo sendo image/*.
        if (fileDoc.metadata && fileDoc.metadata.alunoId) {
            return res.status(403).json({ success: false, error: 'Este arquivo requer autenticação.' });
        }

        streamFile(res, fileDoc, 'public, max-age=3600');
    } catch (error) {
        console.error('Erro no servePublicImage:', error);
        res.status(500).json({ success: false, error: 'Erro ao servir arquivo' });
    }
};
