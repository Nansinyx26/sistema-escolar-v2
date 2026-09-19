#!/usr/bin/env node
/**
 * Encerra as sessões abertas de contas da equipe (Issue #387).
 *
 * Padrão: SIMULA — mostra quantas contas seriam afetadas, por perfil, sem mudar
 * nada. Para aplicar, passe `--aplicar`. Para mirar todas as contas de equipe
 * ativas (e não só as que já usaram login Google), passe `--todas`.
 *
 *   npm run sessoes:encerrar-equipe                       (desenvolvimento, simulação)
 *   CONFIRMO=producao npm run db:producao -- sessoes:encerrar-equipe
 *   CONFIRMO=producao npm run db:producao -- sessoes:encerrar-equipe -- --aplicar
 *
 * Quem tiver a sessão encerrada entra de novo pelo login, com senha e 2FA.
 */
'use strict';
require('dotenv').config({ path: require('node:path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { encerrarSessoesDeEquipe } = require('../src/services/encerramentoSessoesEquipe');

async function main() {
    const aplicar = process.argv.includes('--aplicar');
    const todas = process.argv.includes('--todas');
    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI não definida.');
        process.exit(2);
    }
    await mongoose.connect(process.env.MONGODB_URI, {
        dbName: process.env.MONGODB_DB_NAME || undefined,
    });
    try {
        const r = await encerrarSessoesDeEquipe({ aplicar, todas });
        console.log(`\nAlvo: ${r.alvo}`);
        console.log(`Contas encontradas: ${r.total}`, r.porPerfil);
        if (r.aplicado) {
            console.log(`✅ Sessões encerradas em ${r.alterados} conta(s). Registro no AuditLog.`);
        } else {
            console.log('Simulação: nada foi alterado. Rode com --aplicar para encerrar.');
        }
    } finally {
        await mongoose.disconnect();
    }
}

main().catch((e) => {
    console.error('Falha:', e.message);
    process.exit(1);
});
