/**
 * Migração: carimbar `metadata` nas fotos de aluno já gravadas no GridFS.
 *
 * POR QUE ELA EXISTE
 * ------------------
 * `saveToGridFS()` gravava sem `metadata` nenhum (Issue #228). Como `metadata` é
 * o que `FileController.autorizarArquivo` consulta, a foto do aluno caía na
 * última regra do arquivo — a dos legados, que libera qualquer `image/*` a
 * qualquer autenticado. Nem `alunoId` (que aplicaria `assertAcessoAoAluno`) nem
 * `escolaId` (que barraria outro tenant) existiam para serem consultados.
 *
 * O código novo grava o metadata certo. Esta migração faz o mesmo pelo que já
 * está no bucket: sem ela, toda foto anterior ao deploy continua sem dono.
 *
 * O QUE ELA CARIMBA
 * -----------------
 * Só o arquivo REFERENCIADO em `alunos.foto`, que seja `image/*` e cujo
 * `metadata.type` esteja ausente ou seja `'avatar'`. Nele grava:
 *
 *   { type: 'aluno_foto', alunoId: <_id do aluno>, escolaId: <escola do aluno> }
 *
 * O caso `'avatar'` é de propósito. A migração anterior
 * (`1788480000000-carimbar-avatares-publicos`) carimbou como avatar público todo
 * arquivo referenciado como `foto` de um adulto; se o MESMO arquivo também é
 * `alunos.foto`, "é foto de criança" tem que vencer "é avatar público". O
 * carimbo aqui desfaz aquele — e o `alunoId` sozinho já fecha a rota pública,
 * que recusa qualquer arquivo com esse campo.
 *
 * `chat_anexo`, `voice_message` e `relatorio_ia` NÃO são tocados: já têm tipo
 * declarado, já são privados, e reescrevê-los mudaria a regra de autorização
 * deles sem que ninguém tenha pedido.
 *
 * IDEMPOTENTE: a segunda execução não encontra mais nada para carimbar.
 */

/**
 * Extrai do campo `foto` a referência que o `FileController.findFileDoc` sabe
 * resolver — o ObjectId ou o filename no bucket. Mesmos formatos acumulados que
 * a migração de avatares trata: `gridfs:<id>`, `/api/upload/photo/<id>`,
 * `/api/files/<id>` e o id cru. Base64 e URL externa não vivem no GridFS.
 */
function referenciaDoGridFS(foto) {
    if (typeof foto !== 'string') return null;
    let valor = foto.trim();
    if (!valor || valor === 'null' || valor === 'undefined') return null;
    if (valor.startsWith('data:') || valor.startsWith('http://') || valor.startsWith('https://')) {
        return null;
    }

    const barra = valor.lastIndexOf('/');
    if (barra !== -1) valor = valor.slice(barra + 1);
    if (valor.startsWith('gridfs:')) valor = valor.slice('gridfs:'.length);

    return valor || null;
}

module.exports = {
    version: '1.3',

    async up() {
        const mongoose = require('mongoose');
        const db = mongoose.connection.db;
        const arquivos = db.collection('uploads.files');

        // Em blocos: uma rede grande tem milhares de alunos, e o plano free do
        // Render não aguenta carregar todos de uma vez.
        const TAMANHO_BLOCO = 500;
        let ultimoId = null;
        let carimbados = 0;
        let referencias = 0;

        for (;;) {
            const filtro = { foto: { $type: 'string', $ne: '' } };
            if (ultimoId) filtro._id = { $gt: ultimoId };

            const bloco = await db
                .collection('alunos')
                .find(filtro, { projection: { foto: 1, escolaId: 1 } })
                .sort({ _id: 1 })
                .limit(TAMANHO_BLOCO)
                .toArray();
            if (bloco.length === 0) break;

            ultimoId = bloco[bloco.length - 1]._id;

            for (const aluno of bloco) {
                const ref = referenciaDoGridFS(aluno.foto);
                if (!ref) continue;
                referencias += 1;

                // Um arquivo por aluno: o `alunoId` gravado é o dono, então não
                // dá para agrupar num único `updateMany` como na migração de
                // avatares (lá o valor era o mesmo para todos).
                const alternativas = [{ filename: ref }];
                if (mongoose.Types.ObjectId.isValid(ref)) {
                    alternativas.unshift({ _id: new mongoose.Types.ObjectId(ref) });
                }

                const campos = { 'metadata.type': 'aluno_foto', 'metadata.alunoId': String(aluno._id) };
                if (aluno.escolaId) campos['metadata.escolaId'] = String(aluno.escolaId);

                const resultado = await arquivos.updateOne(
                    {
                        $and: [
                            { $or: alternativas },
                            { contentType: { $regex: '^image/' } },
                            {
                                $or: [
                                    { 'metadata.type': { $exists: false } },
                                    { 'metadata.type': { $in: [null, '', 'avatar'] } },
                                ],
                            },
                        ],
                    },
                    { $set: campos }
                );

                carimbados += resultado.modifiedCount;
            }
        }

        console.log(
            `  … ${carimbados} foto(s) de aluno carimbada(s) ` +
                `(${referencias} referência(s) em alunos.foto)`
        );

        return {
            message: "Fotos de aluno carimbadas com metadata.alunoId/escolaId e type='aluno_foto'",
            carimbados,
            referencias,
        };
    },

    /**
     * ROLLBACK.
     *
     * Remove os três campos que esta migração escreveu, e só nos arquivos que
     * ela marcou (`type: 'aluno_foto'`). Nenhum byte é apagado — só o rótulo.
     *
     * Atenção: voltar atrás devolve a foto do aluno à regra de legado do
     * `FileController`, que libera `image/*` a qualquer autenticado. O `down`
     * existe para acompanhar um rollback de código, não para ser usado sozinho.
     */
    async down() {
        const mongoose = require('mongoose');
        const resultado = await mongoose.connection.db
            .collection('uploads.files')
            .updateMany(
                { 'metadata.type': 'aluno_foto' },
                { $unset: { 'metadata.type': '', 'metadata.alunoId': '', 'metadata.escolaId': '' } }
            );

        return {
            message: 'metadata de foto de aluno removido do bucket',
            revertidos: resultado.modifiedCount,
        };
    },
};
