/**
 * instanciaId.js — Identificador único da instância do backend.
 *
 * Em ambiente de produção no Render, utiliza a variável RENDER_INSTANCE_ID
 * se disponível; caso contrário, compõe com hostname, pid do processo e um
 * identificador aleatório seguro gerado no boot do processo.
 *
 * Utilizado por:
 * - logger.js (injetado em todas as linhas de log estruturado)
 * - travaDistribuida.js (proprietário de locks e leases no MongoDB)
 */

const os = require('node:os');
const crypto = require('node:crypto');

const ID_INSTANCIA =
    process.env.RENDER_INSTANCE_ID ||
    `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;

function obterIdInstancia() {
    return ID_INSTANCIA;
}

module.exports = {
    obterIdInstancia,
    ID_INSTANCIA,
};
