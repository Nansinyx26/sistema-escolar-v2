/**
 * codigosBackup.js — códigos de recuperação de uso único para o 2FA
 * ============================================================================
 * POR QUE EXISTEM
 * ─────────────────────────────────────────────────────────────────────────
 * O segundo fator de diretor e secretaria dependia inteiramente da entrega de
 * e-mail. Quando o provedor bloqueou o envio, os dois perfis ficaram trancados
 * fora do sistema — a indisponibilidade de um serviço de terceiros virou perda
 * total de acesso, sem caminho de recuperação.
 *
 * Um código de backup continua sendo um SEGUNDO FATOR: algo que a pessoa
 * precisa possuir, entregue por um canal separado da senha. A diferença é que
 * ele não atravessa a rede no momento do login.
 *
 * DECISÕES E O PORQUÊ DE CADA UMA
 * ─────────────────────────────────────────────────────────────────────────
 * • Guardados como HASH, nunca em texto puro. Um dump do banco (backup vazado,
 *   injection, acesso indevido ao Atlas) não pode virar um molho de chaves de
 *   segundo fator. Nem o administrador consegue reler um código depois de
 *   gerado — por isso a entrega é feita UMA vez, na resposta da geração.
 *
 * • scrypt, não SHA-256. O espaço de busca de um código é pequeno o bastante
 *   (2^50) para que um hash rápido permita força bruta offline com GPU se o
 *   banco vazar. scrypt custa memória e tempo por tentativa, o que torna isso
 *   caro. É a mesma razão pela qual senha usa bcrypt e não SHA.
 *
 * • USO ÚNICO. `usadoEm` marca o consumo. Um código reutilizável que circula
 *   impresso vira credencial permanente — exatamente o problema do
 *   `twoFactorFixedCode`.
 *
 * • Alfabeto sem 0/O/1/I/L. Estes códigos são LIDOS por pessoas, muitas vezes
 *   de um papel ou por telefone. Ambiguidade vira tentativa errada, e tentativa
 *   errada consome o limite de força bruta de quem é legítimo.
 * ============================================================================
 */

const crypto = require('crypto');

const QUANTIDADE_PADRAO = 8;
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 símbolos, sem ambíguos
const TAMANHO_GRUPO = 5;                            // formato XXXXX-XXXXX

// Parâmetros do scrypt. N=16384 leva ~50ms por verificação nesta classe de
// máquina — imperceptível no login, caro em escala de ataque.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const TAMANHO_HASH = 32;

/** Gera um código legível: 10 símbolos em dois grupos. ~2^49 combinações. */
function gerarUmCodigo() {
    let bruto = '';
    for (let i = 0; i < TAMANHO_GRUPO * 2; i++) {
        // randomInt é uniforme; `% alfabeto.length` sobre bytes crus enviesaria
        // as primeiras letras do alfabeto.
        bruto += ALFABETO[crypto.randomInt(0, ALFABETO.length)];
    }
    return `${bruto.slice(0, TAMANHO_GRUPO)}-${bruto.slice(TAMANHO_GRUPO)}`;
}

function hashDeCodigo(codigo, salt) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(normalizar(codigo), salt, TAMANHO_HASH,
            { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
            (err, chave) => (err ? reject(err) : resolve(chave)));
    });
}

/**
 * Normaliza o que a pessoa digitou.
 *
 * Ela vai errar o hífen, o espaço e a caixa — e um código correto recusado por
 * formatação gasta uma das 5 tentativas antes do bloqueio. O que importa são os
 * 10 símbolos.
 */
function normalizar(codigo) {
    return String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Um valor digitado tem a CARA de um código de backup? */
function pareceCodigoBackup(valor) {
    const limpo = normalizar(valor);
    if (limpo.length !== TAMANHO_GRUPO * 2) return false;
    return [...limpo].every((c) => ALFABETO.includes(c));
}

/**
 * Gera um lote novo. Devolve os códigos em TEXTO PURO (única vez que eles
 * existem legíveis) e os registros a gravar no banco.
 *
 * @returns {Promise<{codigos: string[], registros: Array<{hash: string, usadoEm: null}>}>}
 */
async function gerarLote(quantidade = QUANTIDADE_PADRAO) {
    const codigos = [];
    const registros = [];

    for (let i = 0; i < quantidade; i++) {
        const codigo = gerarUmCodigo();
        const salt = crypto.randomBytes(16);
        const hash = await hashDeCodigo(codigo, salt);
        codigos.push(codigo);
        // salt e hash juntos: cada código tem o seu, então dois códigos iguais
        // em contas diferentes não produzem o mesmo registro.
        registros.push({ hash: `${salt.toString('hex')}:${hash.toString('hex')}`, usadoEm: null });
    }

    return { codigos, registros };
}

/**
 * Confere o código contra os registros e diz QUAL foi consumido.
 *
 * Percorre a lista inteira mesmo depois de achar: sair na primeira coincidência
 * faria o tempo de resposta revelar a posição do código na lista.
 *
 * @returns {Promise<number>} índice do código usado, ou -1 se nenhum bateu.
 */
async function conferir(codigoDigitado, registros) {
    if (!Array.isArray(registros) || !registros.length) return -1;
    if (!pareceCodigoBackup(codigoDigitado)) return -1;

    let encontrado = -1;

    for (let i = 0; i < registros.length; i++) {
        const registro = registros[i];
        if (!registro || typeof registro.hash !== 'string') continue;

        const [saltHex, hashHex] = registro.hash.split(':');
        if (!saltHex || !hashHex) continue;

        let iguais = false;
        try {
            const calculado = await hashDeCodigo(codigoDigitado, Buffer.from(saltHex, 'hex'));
            const esperado = Buffer.from(hashHex, 'hex');
            iguais = calculado.length === esperado.length
                && crypto.timingSafeEqual(calculado, esperado);
        } catch (e) {
            iguais = false;
        }

        // Código já usado NÃO vale — mas ainda assim gastamos o scrypt acima,
        // para que reapresentar um código queimado leve o mesmo tempo que
        // apresentar um inválido.
        if (iguais && !registro.usadoEm && encontrado === -1) encontrado = i;
    }

    return encontrado;
}

module.exports = {
    gerarLote,
    conferir,
    pareceCodigoBackup,
    normalizar,
    QUANTIDADE_PADRAO,
};
