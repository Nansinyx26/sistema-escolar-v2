/**
 * fotoDoAluno.js — a referência gravada em `alunos.foto` é mesmo a foto deste
 * aluno? (Issue #734)
 *
 * O campo `foto` aceita referência interna (`gridfs:<id>`, `/api/files/<id>`,
 * `/api/upload/photo/<id>`, id cru) porque é assim que a foto volta da
 * listagem. O valor era gravado como veio, e na troca seguinte o `update`
 * apagava do bucket "a foto antiga" sem conferir de quem era o arquivo:
 * apontar a foto para o id de outro arquivo e trocar a foto apagava documento
 * de responsável, foto de outro aluno ou anexo de chat, de qualquer escola.
 *
 * Arquivo de foto de aluno é o que `guardarFotoDoAluno` grava (e a migração
 * `carimbar-fotos-de-aluno` carimbou): `metadata.type === 'aluno_foto'` com o
 * `metadata.alunoId` do dono.
 */
const mongoose = require('mongoose');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * O que identifica o arquivo do GridFS num valor de `foto` — o último segmento
 * do caminho, sem o prefixo `gridfs:` (a mesma leitura do `urlFotoAluno`).
 * `null` para vazio, base64 e URL https, que não apontam para o bucket.
 */
function referenciaDaFoto(foto) {
    if (typeof foto !== 'string') return null;
    const valor = foto.trim();
    if (!valor || valor.startsWith('data:') || /^https?:\/\//i.test(valor)) return null;
    let ref = valor.slice(valor.lastIndexOf('/') + 1);
    if (ref.startsWith('gridfs:')) ref = ref.slice('gridfs:'.length);
    return ref || null;
}

/**
 * O arquivo `ref` é a foto do aluno `alunoId`? Falha fechada: referência que
 * não é id do GridFS, arquivo inexistente ou sem o carimbo do dono → `false`.
 */
async function ehFotoDoAluno(ref, alunoId) {
    if (!ref || !OBJECT_ID.test(ref) || !alunoId) return false;
    const arquivo = await mongoose.connection.db
        .collection('uploads.files')
        .findOne({ _id: new mongoose.Types.ObjectId(ref) }, { projection: { metadata: 1 } });
    return (
        arquivo?.metadata?.type === 'aluno_foto' &&
        String(arquivo.metadata.alunoId) === String(alunoId)
    );
}

module.exports = { referenciaDaFoto, ehFotoDoAluno };
