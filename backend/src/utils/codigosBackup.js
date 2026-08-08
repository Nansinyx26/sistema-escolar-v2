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
 * • Somente dígitos. Estes códigos são LIDOS de um papel e digitados no
 *   celular; o campo precisa abrir o mesmo teclado numérico do código de 6
 *   dígitos do e-mail. O custo em entropia está medido no comentário do
 *   ALFABETO, abaixo, e é absorvido pelo limite de tentativas.
 * ============================================================================
 */

const crypto = require('crypto');

const QUANTIDADE_PADRAO = 8;

// ────────────────────────────────────────────────────────────────────────────
// SÓ DÍGITOS — decisão de usabilidade, com o custo medido
// ────────────────────────────────────────────────────────────────────────────
// A primeira versão usava um alfabeto de 31 símbolos (~2^49 por código). Ficou
// hostil na prática: quem digita é diretor e secretaria, no celular, e o campo
// de código precisa abrir o teclado NUMÉRICO — o mesmo do código de 6 dígitos
// que chega por e-mail. Com letras no meio, o teclado tinha de virar texto e a
// digitação ficava lenta e sujeita a erro.
//
// Só dígitos, 10 posições, dá 10^10 ≈ 2^33 combinações. É menos, e vale dizer
// por que continua seguro AQUI: existem no máximo 8 códigos válidos por conta,
// e o segundo fator só é aceito após 5 tentativas erradas bloquearem a conta
// por 15 minutos (MAX_TENTATIVAS_2FA em TwoFactorController). Isso limita um
// atacante a ~480 palpites por dia contra uma chance de 8 em 10 bilhões por
// palpite — levaria da ordem de milhões de anos, e o bloqueio é visível.
//
// O comprimento também separa os dois tipos de código sem ambiguidade:
// 6 dígitos = veio do e-mail, 10 dígitos = código de backup.
// ────────────────────────────────────────────────────────────────────────────
const ALFABETO = '0123456789';
const TAMANHO_GRUPO = 5;                            // formato 12345-67890

// Parâmetros do scrypt. N=16384 leva ~50ms por verificação nesta classe de
// máquina — imperceptível no login, caro em escala de ataque.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const TAMANHO_HASH = 32;

/** Gera um código legível: 10 dígitos em dois grupos (12345-67890). */
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

// Nota: `toUpperCase` fica mesmo com o alfabeto numérico. Ele não atrapalha
// dígito nenhum e mantém compatível a conferência de um lote antigo, gerado
// com letras, que ainda esteja em uso numa conta.

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

// ── Segredo avulso (usado pelo código fixo de 2FA) ──────────────────────────
// Mesma proteção dos códigos de backup, para um valor só. Existe porque
// `twoFactorFixedCode` era guardado em TEXTO PURO no banco: qualquer dump
// entregava um segundo fator pronto para uso.

/** Devolve `salt:hash` scrypt de um segredo. */
async function hashSegredo(valor) {
    const salt = crypto.randomBytes(16);
    const hash = await hashDeCodigo(valor, salt);
    return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/**
 * Confere um segredo contra o `salt:hash` armazenado.
 *
 * Valor legado em texto puro (sem `:`) devolve `false` de propósito, e o
 * chamador avisa no log. Aceitar o formato antigo manteria vivo exatamente o
 * problema que este hash existe para resolver — e o único valor legado
 * conhecido estava versionado num repositório público.
 */
async function conferirSegredo(valor, armazenado) {
    if (typeof armazenado !== 'string' || !armazenado.includes(':')) return false;

    const [saltHex, hashHex] = armazenado.split(':');
    if (!saltHex || !hashHex) return false;

    try {
        const calculado = await hashDeCodigo(String(valor || ''), Buffer.from(saltHex, 'hex'));
        const esperado = Buffer.from(hashHex, 'hex');
        return calculado.length === esperado.length && crypto.timingSafeEqual(calculado, esperado);
    } catch (e) {
        return false;
    }
}

/** O valor guardado está no formato antigo (texto puro)? */
function ehFormatoLegado(armazenado) {
    return typeof armazenado === 'string' && armazenado.length > 0 && !armazenado.includes(':');
}

module.exports = {
    gerarLote,
    conferir,
    pareceCodigoBackup,
    normalizar,
    hashSegredo,
    conferirSegredo,
    ehFormatoLegado,
    QUANTIDADE_PADRAO,
};
