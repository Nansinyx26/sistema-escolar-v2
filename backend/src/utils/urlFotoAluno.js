/**
 * utils/urlFotoAluno.js
 *
 * Converte o campo `foto` do aluno na URL que o frontend usa na tag <img>.
 *
 * POR QUE EXISTE
 * --------------
 * O campo `alunos.foto` acumulou formatos: `gridfs:<id>`, `/api/upload/photo/<id>`,
 * `/api/files/<id>` e o id cru (ver a migração `carimbar-fotos-de-aluno`). A
 * listagem de alunos prefixava `/api/upload/photo/` em QUALQUER valor com mais de
 * 20 caracteres, inclusive no que já era URL — e o navegador pedia
 * `/api/upload/photo/api/upload/photo/<id>`, que responde 404. Como `foto` está na
 * whitelist de edição, salvar o aluno a partir da lista ainda gravava o valor
 * dobrado de volta no banco.
 *
 * Aqui só a referência do GridFS (o último segmento do caminho) é aproveitada,
 * então valores já dobrados também voltam a funcionar.
 */

/**
 * @param {unknown} foto valor bruto de `alunos.foto`
 * @returns {unknown} `/api/upload/photo/<ref>`, ou o valor original quando não é do GridFS
 */
function urlFotoAluno(foto) {
    if (typeof foto !== 'string') return foto;
    const valor = foto.trim();
    if (!valor || valor === 'null' || valor === 'undefined') return foto;

    // Base64 e URL externa (Google, por exemplo) não vivem no GridFS.
    if (valor.startsWith('data:') || /^https?:\/\//i.test(valor)) return foto;

    let ref = valor.slice(valor.lastIndexOf('/') + 1);
    if (ref.startsWith('gridfs:')) ref = ref.slice('gridfs:'.length);

    // Um ObjectId tem 24 caracteres e o nome de arquivo do upload, 37. Valor curto
    // não é referência do GridFS — era a mesma guarda que a listagem já usava.
    if (ref.length <= 20) return foto;

    return `/api/upload/photo/${ref}`;
}

module.exports = urlFotoAluno;
