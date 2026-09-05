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
    if (!fileId) return null;
    let cleanId = String(fileId);
    if (cleanId.startsWith('gridfs:')) {
        cleanId = cleanId.slice('gridfs:'.length);
    }
    const bucket = new GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
    let query;
    if (mongoose.Types.ObjectId.isValid(cleanId)) {
        query = { $or: [{ _id: new mongoose.Types.ObjectId(cleanId) }, { filename: cleanId }, { filename: fileId }] };
    } else {
        query = { filename: cleanId };
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

    // Mensagem de voz de comentário: destinada à audiência do comunicado, não
    // só a quem gravou. Restringir ao dono quebraria o áudio dos comentários.
    // A fronteira que importa aqui já foi aplicada acima (mesma escola); o que
    // esta regra NÃO faz é liberar qualquer outro arquivo do bucket — quem
    // chama por /api/audio ainda precisa passar pelo filtro de contentType.
    if (meta.type === 'voice_message') {
        return { ok: true };
    }

    // Anexo/áudio do chat direto: a regra de `meta.usuarioId` abaixo liberaria
    // só o remetente, deixando o destinatário com 403 no próprio arquivo que
    // acabou de receber. Aqui os dois lados da conversa (e só eles) passam.
    if (meta.type === 'chat_anexo') {
        const meuId = String(req.user?.id || req.user?._id || '');
        const participantes = [
            String(meta.usuarioId || ''),
            String(meta.destinatarioId || ''),
            // Encaminhamento acrescenta o novo destinatário aqui — sem isso ele
            // recebe a mensagem e tropeça num 403 no próprio anexo.
            ...(Array.isArray(meta.compartilhadoCom) ? meta.compartilhadoCom.map(String) : [])
        ];
        if (participantes.includes(meuId)) return { ok: true };
        return { ok: false, status: 403, error: 'Este anexo pertence a outra conversa.' };
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
 * Quarentena de moderação.
 *
 * O upload do chat grava no GridFS e devolve a URL na mesma resposta — ou seja,
 * o arquivo é servível no instante em que termina de subir. Qualquer análise de
 * conteúdo (nudez, violência) leva segundos e só pode acontecer DEPOIS de os
 * bytes estarem no bucket. Sem esta checagem, a janela entre gravar e decidir é
 * uma janela em que a imagem já está entregue e a decisão chega tarde.
 *
 * Por isso a moderação marca `metadata.moderacao.status` e o acesso passa a
 * depender dele. Arquivo sem o campo é arquivo anterior a este código: liberado,
 * senão todo anexo já existente quebraria.
 *
 * A resposta é IGUAL para remetente e destinatário. Devolver 403 a um e 404 a
 * outro (ou variar a mensagem) entrega o veredito da moderação por diferença de
 * comportamento, que é justamente o que a cláusula de feedback ao usuário
 * manda evitar.
 */
function checarQuarentena(fileDoc) {
    const status = fileDoc?.metadata?.moderacao?.status;

    if (!status || status === 'aprovada') return { ok: true };

    if (status === 'bloqueado' || status === 'bloqueada') {
        return {
            ok: false,
            status: 403,
            codigo: 'ANEXO_BLOQUEADO',
            error: 'Este anexo não segue as regras de uso do chat.'
        };
    }

    // 'pendente' | 'em_revisao' — 409 e não 403: o front precisa distinguir
    // "ainda não" de "não", para mostrar o aviso de análise em vez do de recusa.
    return {
        ok: false,
        status: 409,
        codigo: 'ANEXO_EM_ANALISE',
        error: 'Este anexo está em análise e será liberado em breve.'
    };
}

// Reexportados para que QUALQUER rota que sirva bytes do bucket 'uploads' use
// a mesma decisão de autorização. O bucket é único: uma rota que leia dele por
// conta própria (era o caso de /api/audio/:id) contorna todo este arquivo.
exports.autorizarArquivo = autorizarArquivo;
exports.findFileDoc = findFileDoc;
exports.checarQuarentena = checarQuarentena;

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

        // Depois da autorização, de propósito: quem não é da conversa toma 403
        // de acesso e não fica sabendo sequer que o arquivo está em moderação.
        const quarentena = checarQuarentena(fileDoc);
        if (!quarentena.ok) {
            return res.status(quarentena.status).json({
                success: false,
                codigo: quarentena.codigo,
                error: quarentena.error
            });
        }

        streamFile(res, fileDoc);
    } catch (error) {
        console.error('Erro no serveFile:', error);
        res.status(500).json({ success: false, error: 'Erro ao servir arquivo' });
    }
};

/**
 * ALLOWLIST do que sai do bucket SEM sessão.
 *
 * `metadata.type` é a etiqueta que cada caminho de upload carimba no GridFS, e
 * aqui ela é a única credencial que existe: o arquivo só é servido pela rota
 * pública se declarar um tipo E esse tipo estiver nesta lista. Arquivo sem
 * `type` não passa.
 *
 * Até a Issue #216 a lista era um `Set` vazio e a comparação era `meta.type &&
 * !TIPOS_PUBLICOS.has(meta.type)` — ou seja, barrava os tipos privados
 * conhecidos e liberava TODO arquivo sem `type`. Aberto por omissão: qualquer
 * caminho de upload novo que esquecesse de carimbar o tipo nascia público, sem
 * nada acusar. É a mesma forma de falha que a #213 fechou no gate de páginas.
 *
 * Acrescentar um valor aqui é decidir que aquele tipo pode ser lido por
 * qualquer pessoa da internet, sem login. Hoje só o avatar se enquadra.
 */
const TIPOS_PUBLICOS = new Set(['avatar']);

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

        const meta = fileDoc.metadata || {};

        // Documentos de aluno enviados como imagem (foto do RG, por exemplo)
        // NUNCA saem pela rota pública, mesmo sendo image/*.
        if (meta.alunoId) {
            return res.status(403).json({ success: false, error: 'Este arquivo requer autenticação.' });
        }

        // O filtro de contentType acima só barra o que NÃO é imagem — e a foto
        // que um responsável manda no chat é image/jpeg como qualquer avatar.
        // Sem esta checagem, `/api/files/:id` entregava o anexo de uma conversa
        // privada a quem não estava logado, e ainda com `Cache-Control: public`.
        // A autorização por participante existe, mas mora no `serveFile` — esta
        // rota não passa por ela.
        //
        // Fechado por omissão: sem `type`, ou com `type` fora da allowlist, o
        // arquivo exige sessão. Os avatares gravados antes deste código foram
        // carimbados pela migração `carimbar-avatares-publicos`; um arquivo que
        // ela não alcançou não é avatar de ninguém — nenhuma tela aponta para
        // ele — e continuar exigindo sessão é o comportamento correto.
        if (!TIPOS_PUBLICOS.has(meta.type)) {
            return res.status(403).json({ success: false, error: 'Este arquivo requer autenticação.' });
        }

        streamFile(res, fileDoc, 'public, max-age=3600');
    } catch (error) {
        console.error('Erro no servePublicImage:', error);
        res.status(500).json({ success: false, error: 'Erro ao servir arquivo' });
    }
};
