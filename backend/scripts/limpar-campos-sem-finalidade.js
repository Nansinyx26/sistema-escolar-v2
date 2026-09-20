#!/usr/bin/env node
/**
 * Apaga dos cadastros já gravados os campos que saíram do formulário na
 * Issue #408 (`religiao` e `responsabilidadeFinanceira`).
 *
 * Padrão: SIMULA — conta quantos cadastros mudariam, por campo.
 *   --aplicar   remove de verdade (não tem volta; o valor não é guardado)
 *
 * Produção (depois da sua autorização):
 *   CONFIRMO=producao npm run db:producao -- campos:limpar-sem-finalidade
 *   CONFIRMO=producao npm run db:producao -- campos:limpar-sem-finalidade -- --aplicar
 *
 * NÃO é migração de propósito: o CI roda `migrate:up` sozinho em produção, e
 * apagar dado de cadastro precisa de decisão explícita de quem responde pela
 * escola.
 */
'use strict';
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const {
    limparCamposSemFinalidade,
} = require('../src/services/conformidade/limpezaCamposSemFinalidade');

async function main() {
    const aplicar = process.argv.includes('--aplicar');
    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI não definida.');
        process.exit(2);
    }
    await mongoose.connect(process.env.MONGODB_URI, {
        dbName: process.env.MONGODB_DB_NAME || undefined,
    });
    try {
        const r = await limparCamposSemFinalidade({ aplicar });
        console.log('\nCadastros com campo sem finalidade:', r.porCampo);
        console.log(`Documentos no alvo: ${r.documentos}`);
        if (!r.aplicado) {
            console.log('Simulação: nada foi alterado. Rode com --aplicar para remover.');
            return;
        }
        console.log(`✅ Removido de ${r.limpos} cadastro(s). Registro no AuditLog.`);
    } finally {
        await mongoose.disconnect();
    }
}

main().catch((e) => {
    console.error('Falha:', e.message);
    process.exit(1);
});
