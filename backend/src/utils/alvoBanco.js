/**
 * alvoBanco.js — trava de confirmação para comandos que tocam PRODUÇÃO.
 *
 * POR QUE ISTO EXISTE (Issue #60)
 * ------------------------------
 * Este projeto rodou uma migração contra os dados reais de 27 alunos acreditando
 * estar em desenvolvimento. Não houve descuido de digitação: o secret do CI se
 * chamava `MONGODB_URI_DEV` e apontava para produção. O nome mentia, e nome de
 * variável é a única coisa que separava um banco do outro.
 *
 * A lição é que a distinção não pode depender de memória, de atenção nem de
 * nomenclatura. Precisa ser uma parada dura no caminho:
 *
 *   1. o PADRÃO é sempre desenvolvimento — errar não tem consequência;
 *   2. produção mora em outro arquivo de ambiente, que nenhum comando normal lê;
 *   3. mesmo apontando para produção de propósito, o comando RECUSA rodar sem
 *      uma confirmação explícita.
 *
 * O item 3 é o que protege contra o operador distraído — humano ou agente.
 *
 * Este módulo é PURO: recebe valores, devolve decisão. Quem lê arquivo e executa
 * processo é `scripts/db-alvo.js`. É essa separação que permite testar a trava
 * sem tocar em banco nenhum.
 */

/** Valor que a variável `CONFIRMO` precisa ter para liberar produção. */
const CONFIRMACAO_EXIGIDA = 'producao';

/**
 * Extrai host e nome do banco de uma URI do MongoDB, **sem a senha**.
 *
 * A senha nunca sai daqui: este resumo vai para a tela e para o log, e um
 * comando de infraestrutura que imprime credencial é um vazamento esperando
 * acontecer.
 *
 * @param {string} uri
 * @returns {{host: string, banco: string}}
 */
function resumirUri(uri) {
    const texto = String(uri || '');
    const casamento = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?/i.exec(texto);
    if (!casamento) return { host: '(uri não reconhecida)', banco: '' };
    return { host: casamento[1], banco: casamento[2] || '' };
}

/**
 * Decide se um comando pode rodar contra o alvo pedido.
 *
 * @param {object} entrada
 * @param {string} entrada.alvo          'desenvolvimento' | 'producao'
 * @param {string} [entrada.confirmacao] valor da variável de ambiente CONFIRMO
 * @param {string} [entrada.uri]         MONGODB_URI já resolvida para o alvo
 * @param {string} [entrada.dbName]      MONGODB_DB_NAME, que vence sobre a URI
 * @returns {{ok: boolean, motivo?: string, resumo: {alvo: string, host: string, banco: string}}}
 */
function avaliarAlvo({ alvo, confirmacao, uri, dbName }) {
    const { host, banco } = resumirUri(uri);
    // `MONGODB_DB_NAME` sobrescreve o caminho da URI em `utils/db.js`. Se o
    // resumo ignorasse isso, ele mostraria um banco e o comando tocaria outro —
    // que é exatamente o tipo de divergência que esta trava existe para impedir.
    const bancoEfetivo = dbName || banco || '(padrão do driver)';
    const resumo = { alvo, host, banco: bancoEfetivo };

    if (!uri) {
        return { ok: false, motivo: 'MONGODB_URI não definida para este alvo.', resumo };
    }

    if (alvo !== 'producao') return { ok: true, resumo };

    if (confirmacao !== CONFIRMACAO_EXIGIDA) {
        return {
            ok: false,
            motivo:
                `Alvo de PRODUÇÃO exige confirmação explícita. ` +
                `Repita com CONFIRMO=${CONFIRMACAO_EXIGIDA} na frente do comando.`,
            resumo,
        };
    }

    return { ok: true, resumo };
}

/** Bloco legível para a tela, sem nenhum segredo. */
function formatarResumo(resumo) {
    const rotulo = resumo.alvo === 'producao' ? '⚠️  PRODUÇÃO' : 'desenvolvimento';
    return [
        '',
        '  ┌─────────────────────────────────────────────',
        `  │ ALVO   : ${rotulo}`,
        `  │ host   : ${resumo.host}`,
        `  │ banco  : ${resumo.banco}`,
        '  └─────────────────────────────────────────────',
        '',
    ].join('\n');
}

module.exports = { avaliarAlvo, resumirUri, formatarResumo, CONFIRMACAO_EXIGIDA };
