/**
 * Direitos autorais — identifica imagem ou áudio protegido e bloqueia o arquivo.
 * Issue #509. Ver docs/DIREITOS-AUTORAIS.md.
 *
 * Duas pontas:
 *   - UPLOAD: `analisar()` recusa o arquivo que bate com o catálogo
 *     (`ObraProtegida`) ou que declara aviso de copyright de terceiro;
 *   - DOWNLOAD: `bloquearArquivoArmazenado()` marca o arquivo específico no
 *     bucket 'uploads', e `checarBloqueioArquivo()` faz toda rota que serve o
 *     bucket responder 451 para ele.
 */
const mongoose = require('mongoose');
const ObraProtegida = require('../../models/ObraProtegida');
const obs = require('../../observability');
const { getFileStream } = require('../../utils/gridfs');
const {
    LIMIAR_HAMMING,
    calcularImpressao,
    distanciaHamming,
    phashInformativo,
    midiaDe,
} = require('./impressaoDigital');
const { detectarAvisoCopyright } = require('./avisoCopyright');

const CODIGO = 'DIREITOS_AUTORAIS';

function escopo(escolaId) {
    if (!escolaId) return { ativo: true, escolaId: null };
    return { ativo: true, $or: [{ escolaId: null }, { escolaId: String(escolaId) }] };
}

function mesmaImpressao(impressao) {
    const alternativas = [{ sha256: impressao.sha256 }];
    if (impressao.conteudoHash) alternativas.push({ conteudoHash: impressao.conteudoHash });
    return alternativas;
}

async function obraBloqueada(impressao, escolaId) {
    const filtro = { ...escopo(escolaId), acao: 'bloquear', midia: impressao.midia };

    const exata = await ObraProtegida.findOne({
        $and: [filtro, { $or: mesmaImpressao(impressao) }],
    }).lean();
    if (exata) return exata;

    if (impressao.midia !== 'imagem' || !phashInformativo(impressao.phash)) return null;

    // Hamming não tem índice: o catálogo é da ordem de centenas de itens por
    // escola, e só a impressão perceptual é trazida.
    const candidatas = await ObraProtegida.find(
        { ...filtro, phash: { $exists: true, $ne: null } },
        { phash: 1, titulo: 1, titular: 1 }
    ).lean();
    return (
        candidatas.find(
            (obra) =>
                phashInformativo(obra.phash) &&
                distanciaHamming(obra.phash, impressao.phash) <= LIMIAR_HAMMING
        ) || null
    );
}

async function liberada(impressao, escolaId) {
    const achado = await ObraProtegida.exists({
        $and: [{ ...escopo(escolaId), acao: 'liberar' }, { $or: mesmaImpressao(impressao) }],
    });
    return Boolean(achado);
}

/**
 * Decide se o arquivo pode entrar.
 *
 * @returns {Promise<{ ok: true, impressao: object|null } |
 *   { ok: false, codigo: string, motivo: string, impressao: object }>}
 */
function analisar(buffer, mimetype, { escolaId } = {}) {
    return obs.withSpan(
        'direitos_autorais.analisar',
        { mimetype: String(mimetype) },
        async (span) => {
            const impressao = await calcularImpressao(buffer, mimetype);
            if (!impressao) return { ok: true, impressao: null };

            const obra = await obraBloqueada(impressao, escolaId);
            if (obra) {
                span.setAttribute('direitos_autorais.veredito', 'catalogo');
                const titulo = obra.titulo ? ` ("${obra.titulo}")` : '';
                return {
                    ok: false,
                    codigo: CODIGO,
                    obraId: String(obra._id),
                    impressao,
                    motivo: `este arquivo é uma obra protegida por direitos autorais${titulo} e foi bloqueado pela escola.`,
                };
            }

            const aviso = await detectarAvisoCopyright(buffer, impressao.midia);
            if (aviso && !(await liberada(impressao, escolaId))) {
                span.setAttribute('direitos_autorais.veredito', `aviso_${aviso.fonte}`);
                return {
                    ok: false,
                    codigo: CODIGO,
                    impressao,
                    aviso,
                    motivo: `o arquivo traz aviso de direitos autorais ("${aviso.texto}"). Só envie obra sua ou com autorização do titular — se os direitos são seus, peça à direção para liberar este arquivo.`,
                };
            }

            span.setAttribute('direitos_autorais.veredito', 'livre');
            return { ok: true, impressao };
        }
    );
}

/** Marca no bucket os arquivos já armazenados que são cópia da obra. */
async function marcarArquivos(obra, arquivoIdExtra) {
    const alvo = [{ 'metadata.impressao.sha256': obra.sha256 }];
    if (obra.conteudoHash) alvo.push({ 'metadata.impressao.conteudoHash': obra.conteudoHash });
    if (arquivoIdExtra) alvo.push({ _id: new mongoose.Types.ObjectId(String(arquivoIdExtra)) });

    const filtro = { $or: alvo };
    if (obra.escolaId) filtro['metadata.escolaId'] = String(obra.escolaId);

    const resultado = await mongoose.connection.db.collection('uploads.files').updateMany(filtro, {
        $set: {
            'metadata.bloqueioDireitosAutorais': { obraId: String(obra._id), em: new Date() },
        },
    });
    return resultado.modifiedCount;
}

function montarObra({ impressao, dados, escolaId, usuario, origemArquivoId }) {
    return {
        acao: dados.acao === 'liberar' ? 'liberar' : 'bloquear',
        midia: impressao.midia,
        titulo: dados.titulo,
        titular: dados.titular,
        motivo: dados.motivo,
        sha256: impressao.sha256,
        conteudoHash: impressao.conteudoHash || undefined,
        phash: impressao.phash || undefined,
        escolaId: escolaId ? String(escolaId) : null,
        origemArquivoId,
        criadoPor: {
            usuarioId: String(usuario?.id || usuario?._id || ''),
            perfil: String(usuario?.perfil || ''),
        },
    };
}

/**
 * Cadastra uma obra a partir de um arquivo de referência enviado pela direção.
 * @returns {Promise<{ obra: object, arquivosBloqueados: number }>}
 */
async function cadastrarObra({ buffer, mimetype, dados = {}, escolaId, usuario }) {
    const impressao = await calcularImpressao(buffer, mimetype);
    if (!impressao) {
        const erro = new Error('Só imagem ou áudio podem ser cadastrados.');
        erro.status = 400;
        throw erro;
    }

    const obra = await ObraProtegida.create(montarObra({ impressao, dados, escolaId, usuario }));
    const arquivosBloqueados = obra.acao === 'bloquear' ? await marcarArquivos(obra) : 0;
    return { obra, arquivosBloqueados };
}

async function lerArquivo(id) {
    const partes = [];
    for await (const parte of getFileStream(String(id))) partes.push(parte);
    return Buffer.concat(partes);
}

/**
 * Bloqueia um arquivo já armazenado — "aquele arquivo específico" — e cataloga
 * a impressão dele para que nem ele nem cópias voltem a entrar.
 *
 * Arquivo que carrega `metadata.impressao` (carimbado no upload) usa essa
 * impressão, que é a do arquivo ORIGINAL: a foto de perfil é guardada como
 * WebP recodificado, e o SHA-256 dos bytes guardados nunca bateria com o
 * reenvio do mesmo JPEG.
 *
 * @returns {Promise<{ obra: object, arquivosBloqueados: number } | null>}
 *   null quando o arquivo não existe, não é imagem/áudio ou é de outra escola.
 */
async function bloquearArquivoArmazenado({ arquivoDoc, dados = {}, escolaId, usuario }) {
    if (!midiaDe(arquivoDoc?.contentType)) return null;

    const meta = arquivoDoc.metadata || {};
    const calculada = await calcularImpressao(
        await lerArquivo(arquivoDoc._id),
        arquivoDoc.contentType
    );
    const carimbo = meta.impressao || {};
    const impressao = {
        midia: calculada.midia,
        sha256: carimbo.sha256 || calculada.sha256,
        conteudoHash: carimbo.conteudoHash || calculada.conteudoHash,
        phash: carimbo.phash || calculada.phash,
    };

    const obra = await ObraProtegida.create(
        montarObra({
            impressao,
            dados: { ...dados, acao: 'bloquear' },
            escolaId,
            usuario,
            origemArquivoId: String(arquivoDoc._id),
        })
    );
    const arquivosBloqueados = await marcarArquivos(obra, arquivoDoc._id);
    return { obra, arquivosBloqueados };
}

/**
 * Desativa a obra e devolve o acesso aos arquivos que ela bloqueou.
 * @returns {Promise<object|null>} a obra, ou null se não existe no escopo.
 */
async function removerObra(id, { escolaId, redeToda }) {
    if (!mongoose.Types.ObjectId.isValid(String(id))) return null;
    const filtro = { _id: id, ativo: true };
    if (!redeToda) filtro.escolaId = String(escolaId || '');

    const obra = await ObraProtegida.findOneAndUpdate(filtro, { ativo: false }, { new: true });
    if (!obra) return null;

    await mongoose.connection.db
        .collection('uploads.files')
        .updateMany(
            { 'metadata.bloqueioDireitosAutorais.obraId': String(obra._id) },
            { $unset: { 'metadata.bloqueioDireitosAutorais': '' } }
        );
    return obra;
}

function listarObras({ escolaId, redeToda }) {
    const filtro = redeToda ? { ativo: true } : escopo(escolaId);
    return ObraProtegida.find(filtro).sort({ createdAt: -1 }).limit(500).lean();
}

/**
 * Gate de download. 451 é "Unavailable For Legal Reasons" (RFC 7725): o
 * arquivo existe, mas não pode ser entregue por motivo legal.
 */
function checarBloqueioArquivo(fileDoc) {
    if (!fileDoc?.metadata?.bloqueioDireitosAutorais) return { ok: true };
    return {
        ok: false,
        status: 451,
        codigo: CODIGO,
        error: 'Este arquivo foi bloqueado por violar direitos autorais.',
    };
}

/** O que o upload grava em `metadata.impressao` para bloqueios futuros. */
function carimboImpressao(arquivo) {
    const impressao = arquivo?.impressaoDireitosAutorais;
    if (!impressao) return undefined;
    return {
        sha256: impressao.sha256,
        conteudoHash: impressao.conteudoHash || undefined,
        phash: impressao.phash || undefined,
    };
}

module.exports = {
    analisar,
    cadastrarObra,
    bloquearArquivoArmazenado,
    removerObra,
    listarObras,
    checarBloqueioArquivo,
    carimboImpressao,
};
