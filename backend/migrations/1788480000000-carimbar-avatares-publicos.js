/**
 * Migração: carimbar `metadata.type = 'avatar'` nos avatares já gravados no GridFS.
 *
 * POR QUE ELA EXISTE
 * ------------------
 * A rota pública `GET /api/files/:id` passou a ser uma ALLOWLIST fechada por
 * omissão (Issue #216): só sai sem sessão o arquivo cujo `metadata.type` está
 * em `TIPOS_PUBLICOS` — hoje, só `'avatar'`.
 *
 * Os avatares que já estão no bucket não têm `type` nenhum. Foram gravados por
 * `scripts/migrate-base64-photos-to-gridfs.js`, que usa `saveToGridFS()` — e
 * essa função não escreve metadata. Sem esta migração, inverter a checagem
 * apagaria a foto de perfil de todo mundo que já subiu uma.
 *
 * O QUE ELA CARIMBA
 * -----------------
 * Só o arquivo que satisfaz as QUATRO condições:
 *
 *   1. está REFERENCIADO como `foto` de uma pessoa adulta do sistema
 *      (`usuarios`, `professores`, `diretores`, `secretarias`);
 *   2. é `image/*`;
 *   3. ainda não tem `metadata.type` (nada carimbado é sobrescrito);
 *   4. não tem `metadata.alunoId`.
 *
 * A condição 1 é o coração da migração: ela não abre o bucket por formato, abre
 * exatamente o que alguma tela já exibe como avatar. Arquivo órfão — que
 * ninguém referencia — permanece sem `type` e passa a exigir sessão. Isso não é
 * regressão: nenhuma tela aponta para ele.
 *
 * O QUE ELA NÃO TOCA
 * ------------------
 * `alunos.foto`. Foto de criança não é avatar público, e as duas rotas que a
 * devolvem (`StudentController.getAll` e `getById`) já a normalizam para
 * `/api/upload/photo/:id`, que exige `authJWT`. Deixá-la sem `type` é o
 * resultado desejado, não um efeito colateral.
 *
 * IDEMPOTENTE: rodar de novo não carimba nada além do que já carimbou.
 */

const PESSOAS_COM_AVATAR = ['usuarios', 'professores', 'diretores', 'secretarias'];

/**
 * Extrai do campo `foto` a referência que o `FileController.findFileDoc` sabe
 * resolver — o ObjectId ou o filename no bucket.
 *
 * O campo acumulou formatos ao longo do tempo: `gridfs:<id>` (a migração de
 * base64), `/api/upload/photo/<id>` e `/api/files/<id>` (normalização das
 * respostas), e o id cru. Base64 e URL externa não vivem no GridFS e são
 * descartadas aqui.
 */
function referenciaDoGridFS(foto) {
    if (typeof foto !== 'string') return null;
    let valor = foto.trim();
    if (!valor || valor === 'null' || valor === 'undefined') return null;
    if (valor.startsWith('data:') || valor.startsWith('http://') || valor.startsWith('https://')) {
        return null;
    }

    // Fica só o último segmento de caminho: cobre as duas formas de URL sem
    // precisar enumerá-las.
    const barra = valor.lastIndexOf('/');
    if (barra !== -1) valor = valor.slice(barra + 1);

    if (valor.startsWith('gridfs:')) valor = valor.slice('gridfs:'.length);

    return valor || null;
}

module.exports = {
    version: '1.2',

    async up() {
        const mongoose = require('mongoose');
        const db = mongoose.connection.db;
        const arquivos = db.collection('uploads.files');

        // ── 1. Todas as referências de avatar que existem hoje ───────────────
        const referencias = new Set();
        for (const nome of PESSOAS_COM_AVATAR) {
            const docs = await db
                .collection(nome)
                .find({ foto: { $type: 'string', $ne: '' } }, { projection: { foto: 1 } })
                .toArray();
            for (const doc of docs) {
                const ref = referenciaDoGridFS(doc.foto);
                if (ref) referencias.add(ref);
            }
        }

        if (referencias.size === 0) {
            return { message: 'Nenhum avatar em GridFS para carimbar', carimbados: 0, referencias: 0 };
        }

        // ── 2. Resolve cada referência: pode ser _id ou filename ─────────────
        const ids = [];
        const filenames = [];
        for (const ref of referencias) {
            if (mongoose.Types.ObjectId.isValid(ref)) ids.push(new mongoose.Types.ObjectId(ref));
            filenames.push(ref);
        }

        // ── 3. Carimba, e SÓ o que ainda não tem tipo ────────────────────────
        //
        // `metadata.type: {$exists: false}` junto de `$in: [null, '']` cobre o
        // arquivo sem metadata nenhum e o que tem metadata com o campo vazio.
        // Um arquivo já carimbado (`chat_anexo`, `voice_message`, `avatar`)
        // nunca é reescrito — é o que torna a migração repetível sem risco.
        const resultado = await arquivos.updateMany(
            {
                $or: [{ _id: { $in: ids } }, { filename: { $in: filenames } }],
                contentType: { $regex: '^image/' },
                $and: [
                    { $or: [{ 'metadata.type': { $exists: false } }, { 'metadata.type': { $in: [null, ''] } }] },
                    { $or: [{ 'metadata.alunoId': { $exists: false } }, { 'metadata.alunoId': { $in: [null, ''] } }] },
                ],
            },
            { $set: { 'metadata.type': 'avatar' } }
        );

        console.log(
            `  … ${resultado.modifiedCount} arquivo(s) carimbado(s) como 'avatar' ` +
                `(${referencias.size} referência(s) de foto encontradas)`
        );

        return {
            message: "Avatares existentes carimbados com metadata.type='avatar'",
            carimbados: resultado.modifiedCount,
            referencias: referencias.size,
        };
    },

    /**
     * ROLLBACK.
     *
     * Remove `metadata.type` de todo arquivo marcado como 'avatar'. Alcança
     * também os avatares enviados DEPOIS desta migração — e é intencional: o
     * `down` só faz sentido acompanhado da volta do código antigo, no qual era
     * justamente a AUSÊNCIA de `type` que liberava a rota pública. Devolver o
     * campo ao estado anterior é o que mantém os avatares carregando lá.
     *
     * Nenhum byte é apagado: só o rótulo sai.
     */
    async down() {
        const mongoose = require('mongoose');
        const resultado = await mongoose.connection.db
            .collection('uploads.files')
            .updateMany({ 'metadata.type': 'avatar' }, { $unset: { 'metadata.type': '' } });

        return {
            message: "metadata.type='avatar' removido dos arquivos do bucket",
            revertidos: resultado.modifiedCount,
        };
    },
};
