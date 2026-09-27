#!/usr/bin/env node
/**
 * Liga (ou desliga) o super admin de uma conta de admin (Issue #463).
 *
 * Não existe rota que faça isso, de propósito: o super admin bloqueia escolas
 * inteiras, e um admin comum que pudesse se promover pela API anularia a
 * separação entre os dois. Quem define o super admin é quem tem acesso ao banco.
 *
 *   npm run superadmin:definir -- admin@rede.gov.br
 *   npm run superadmin:definir -- admin@rede.gov.br --remover
 *   CONFIRMO=producao npm run db:producao -- superadmin:definir -- admin@rede.gov.br
 *
 * A troca fica registrada no AuditLog.
 */
'use strict';
require('dotenv').config({ path: require('node:path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Usuario = require('../src/models/Usuario');
const AuditLog = require('../src/models/AuditLog');

async function main() {
    const email = String(process.argv[2] || '').trim().toLowerCase();
    const remover = process.argv.includes('--remover');
    if (!email || email.startsWith('--')) {
        console.error('Uso: npm run superadmin:definir -- <email-do-admin> [--remover]');
        process.exit(2);
    }
    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI não definida.');
        process.exit(2);
    }
    await mongoose.connect(process.env.MONGODB_URI, {
        dbName: process.env.MONGODB_DB_NAME || undefined,
    });
    try {
        const conta = await Usuario.findOne({ email }).select('perfil superAdmin nome').lean();
        if (!conta) throw new Error('Conta não encontrada.');
        if (conta.perfil !== 'admin') {
            throw new Error(`A conta tem perfil "${conta.perfil}". Só uma conta admin pode ser super admin.`);
        }
        await Usuario.updateOne({ _id: conta._id }, { $set: { superAdmin: !remover } });
        await AuditLog.create({
            usuarioId: conta._id,
            usuarioNome: 'Script de manutenção',
            perfil: 'N/A',
            acao: remover ? 'SUPERADMIN_REMOVIDO' : 'SUPERADMIN_DEFINIDO',
            recurso: 'Usuarios',
            recursoId: String(conta._id),
            detalhes: {
                valorAnterior: { superAdmin: conta.superAdmin === true },
                valorNovo: { superAdmin: !remover },
                descricao: `superAdmin ${remover ? 'removido de' : 'definido para'} ${conta._id} via script.`,
            },
        });
        console.log(`✅ superAdmin ${remover ? 'removido' : 'ativado'} para a conta ${conta._id}.`);
    } finally {
        await mongoose.disconnect();
    }
}

main().catch((e) => {
    console.error('Falha:', e.message);
    process.exit(1);
});
