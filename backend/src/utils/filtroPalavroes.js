/**
 * utils/filtroPalavroes.js — ponte do backend para o filtro de palavrões.
 *
 * O motor e o léxico vivem em `js/filtro-palavroes.js`, na raiz do projeto,
 * porque o MESMO arquivo é carregado pelo navegador. Duplicar o dicionário
 * aqui garantiria, mais cedo ou mais tarde, um front que bloqueia o que o back
 * aceita — ou pior, o contrário: o aviso não aparece e o texto entra no banco.
 *
 * O `require` cruza a fronteira backend/ → raiz/ de propósito. O deploy do
 * Render sobe o repositório inteiro (o próprio `app.js` serve o frontend a
 * partir de `../../`), então o caminho existe em produção. Se um dia deixar de
 * existir, é melhor o processo morrer no arranque do que subir sem moderação —
 * por isso NÃO há try/catch em volta do require.
 *
 * Ajuste por ambiente (todas opcionais, ver config/env.js):
 *   FILTRO_PALAVROES_NIVEIS   — níveis que bloqueiam. Ex.: "grave,moderado,leve"
 *   FILTRO_PALAVROES_EXTRAS   — termos adicionais. Ex.: "jegue,mula"
 *   FILTRO_PALAVROES_EXCECOES — termos a liberar.  Ex.: "veado,bicha"
 */

const filtro = require('../../../js/filtro-palavroes');
const logger = require('./logger');

const NIVEIS_VALIDOS = new Set(filtro.NIVEIS);

/** "a, b ,c" → ['a','b','c'] (vazios descartados). */
function listaDoAmbiente(nome) {
    return String(process.env[nome] || '')
        .split(',')
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
}

const niveis = listaDoAmbiente('FILTRO_PALAVROES_NIVEIS').filter(n => NIVEIS_VALIDOS.has(n));
const extras = listaDoAmbiente('FILTRO_PALAVROES_EXTRAS');
const excecoes = listaDoAmbiente('FILTRO_PALAVROES_EXCECOES');

filtro.configurar({
    bloquearNiveis: niveis.length > 0 ? niveis : undefined,
    termosExtras: extras.length > 0 ? extras : undefined,
    excecoes: excecoes.length > 0 ? excecoes : undefined
});

/**
 * Registra a tentativa bloqueada.
 *
 * O texto ofensivo NUNCA vai para o log: o objetivo é saber que houve
 * tentativa e de quem, não arquivar o xingamento em texto puro num arquivo que
 * pode ser lido por qualquer um com acesso ao servidor. Só os termos
 * detectados (que já estão no dicionário público deste repositório) e o nível.
 */
function registrarTentativa(req, { campo, resultado, recurso }) {
    const usuario = req && req.user ? (req.user.id || req.user._id) : 'anônimo';
    logger.warn(
        `[FiltroPalavroes] Envio bloqueado em ${recurso || req?.originalUrl || 'desconhecido'} `
        + `(campo "${campo}") — usuário ${usuario}, nível ${resultado.nivel}, `
        + `termos: ${resultado.termos.join(', ')}`
    );
}

module.exports = {
    ...filtro,
    registrarTentativa
};
