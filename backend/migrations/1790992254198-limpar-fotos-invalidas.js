/**
 * Migração: limpar fotos em formato inválido já gravadas (Issue #584).
 *
 * POR QUE ELA EXISTE
 * ------------------
 * O sanitizador global deixa as aspas passarem, e o front monta
 * `<img src="${foto}">` por interpolação. Um `foto` como `x" onerror="…"`
 * fechava o atributo e virava handler executável (a CSP permite
 * `script-src-attr 'unsafe-inline'`). A #572 passou a recusar esse formato nas
 * gravações novas (`src/middleware/validarFoto.js`), e a #582/#583 escapou os
 * atributos no front. O que foi gravado ANTES continua no banco — esta
 * migração limpa.
 *
 * O QUE ELA FAZ
 * -------------
 * Percorre os campos de foto abaixo e zera ('' = sem foto, que o front já trata
 * mostrando as iniciais) o valor que é PERIGOSO: tem aspa, `<`, `>` ou crase
 * (o que fecha o atributo), usa esquema executável (`javascript:`, `vbscript:`,
 * `file:`, `blob:`) ou é data URI que não seja imagem raster (SVG carrega
 * script). E, como trava, nunca zera o que `fotoValida` — a regra do
 * middleware — aceita.
 *
 * Não basta "o que `fotoValida` recusa": ela também recusa valor inofensivo,
 * como URL `http://` ou nome de arquivo com espaço. Nenhum dos dois sai de um
 * atributo entre aspas, e uma foto `http://…/api/files/<id>` ainda carrega (o
 * navegador promove para https). Apagá-las seria perder foto de gente sem
 * fechar risco nenhum; elas caem na regra nova na próxima edição.
 *
 * A data URI de imagem raster válida (o caso grande, centenas de KB) já sai
 * filtrada na própria consulta, para não trazer megabytes à toa. O resto
 * (gridfs, id, URL, e o que for inválido) é pequeno e passa por `fotoValida`.
 *
 * A escrita só acontece se o campo ainda tiver o valor lido — uma edição feita
 * no meio da migração não é atropelada. Por isso também é IDEMPOTENTE: na
 * segunda execução não sobra nada inválido para limpar.
 *
 * O log traz só a contagem por coleção. O valor nunca vai para o log: além de
 * ser o próprio payload, pode carregar dado pessoal.
 */

const { fotoValida } = require('../src/middleware/validarFoto');

// Espelha DATA_URI_IMAGEM do validarFoto: serve para NÃO trazer na consulta o
// que é certamente válido (o caso grande) e para separar data URI de imagem
// raster da que carrega script.
const DATA_URI_VALIDA = /^data:image\/(png|jpe?g|webp|gif|bmp|avif);base64,[A-Za-z0-9+/=\r\n]+$/i;

/** O valor consegue sair do atributo `src` ou executar script? */
function perigosa(valor) {
    if (/["'<>`]/.test(valor)) return true;
    if (/^\s*(javascript|vbscript|file|blob):/i.test(valor)) return true;
    if (/^\s*data:/i.test(valor) && !DATA_URI_VALIDA.test(valor)) return true;
    return false;
}

/** Model + campos de foto que o front interpola em `src`. */
function alvos() {
    return [
        { model: require('../src/models/Usuario'), campos: ['foto', 'fotoGoogle'] },
        { model: require('../src/models/Professor'), campos: ['foto'] },
        { model: require('../src/models/Diretor'), campos: ['foto'] },
        { model: require('../src/models/Secretaria'), campos: ['foto'] },
        { model: require('../src/models/Aluno'), campos: ['foto'] },
        // Cópia da foto do autor gravada no comentário (ComentarioController.add).
        { model: require('../src/models/Comentario'), campos: ['usuarioFoto'] },
    ];
}

module.exports = {
    version: '1.9',

    async up() {
        const mongoose = require('mongoose');
        const db = mongoose.connection.db;
        const limpos = {};
        let total = 0;

        for (const { model, campos } of alvos()) {
            // O nome vem do model: `professores` e `diretores` não seguem a
            // pluralização padrão do Mongoose.
            const nomeColecao = model.collection.collectionName;
            const colecao = db.collection(nomeColecao);

            for (const campo of campos) {
                const cursor = colecao.find(
                    { [campo]: { $type: 'string', $ne: '', $not: DATA_URI_VALIDA } },
                    { projection: { [campo]: 1 } }
                );

                let limposNoCampo = 0;
                for await (const doc of cursor) {
                    const valor = doc[campo];
                    if (fotoValida(valor) || !perigosa(valor)) continue;

                    const resultado = await colecao.updateOne(
                        { _id: doc._id, [campo]: valor },
                        { $set: { [campo]: '' } }
                    );
                    limposNoCampo += resultado.modifiedCount;
                }

                if (limposNoCampo > 0) limpos[`${nomeColecao}.${campo}`] = limposNoCampo;
                total += limposNoCampo;
            }
        }

        console.log(`  … ${total} foto(s) em formato inválido limpa(s)`, limpos);

        return { message: 'Fotos em formato inválido limpas', total, limpos };
    },

    /**
     * ROLLBACK — intencionalmente sem efeito.
     *
     * Desfazer significaria gravar de volta valores que quebram o atributo
     * `src` e executam script no navegador de quem abre a tela. Eles também não
     * foram guardados: copiar o payload para outra coleção só mudaria o lugar
     * do problema. A perda é a foto de quem tinha um valor inválido — que já
     * não carregava como imagem —, e a pessoa pode enviá-la de novo.
     */
    async down() {
        return {
            message: 'Sem efeito: os valores removidos eram payload inválido e não são restaurados',
        };
    },
};
