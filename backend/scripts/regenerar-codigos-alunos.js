#!/usr/bin/env node
/**
 * Regenera os códigos de vínculo dos alunos (Issue #389).
 *
 * Padrão: SIMULA — mostra quantos alunos seriam afetados, por escola.
 *   --aplicar               troca os códigos (os antigos param de funcionar na hora)
 *   --somente-sem-vinculo   só alunos ainda sem responsável vinculado
 *   --escola=<id>           só uma escola
 *   --saida=<arquivo.csv>   grava a lista (escola, turma, nome, RA, código) para
 *                           a secretaria redistribuir. Fica FORA do repositório:
 *                           o arquivo tem nome de criança e credencial de vínculo.
 *                           Sem --saida, a secretaria consulta a tela
 *                           "Códigos secretos", que já mostra os códigos novos.
 *
 * Produção (depois da sua autorização):
 *   CONFIRMO=producao npm run db:producao -- codigos:regenerar-alunos
 *   CONFIRMO=producao npm run db:producao -- codigos:regenerar-alunos -- --aplicar --saida=C:\caminho\codigos.csv
 *
 * NÃO é migração de propósito: o CI roda `migrate:up` sozinho em produção, e
 * esta troca precisa de decisão explícita e de aviso às famílias.
 */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { regenerarCodigosDeAlunos } = require('../src/services/regeneracaoCodigosAluno');

const RAIZ_REPO = path.resolve(__dirname, '../..');

function argumento(nome) {
    const achado = process.argv.find((a) => a.startsWith(`--${nome}=`));
    return achado ? achado.slice(nome.length + 3) : null;
}

function csv(linhas) {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const cab = ['escolaId', 'turma', 'nome', 'matricula', 'codigo'];
    return [cab.join(';'), ...linhas.map((l) => cab.map((c) => esc(l[c])).join(';'))].join('\n');
}

async function main() {
    const aplicar = process.argv.includes('--aplicar');
    const somenteSemVinculo = process.argv.includes('--somente-sem-vinculo');
    const escolaId = argumento('escola');
    const saida = argumento('saida');

    if (saida) {
        const destino = path.resolve(saida);
        if (destino.startsWith(RAIZ_REPO + path.sep)) {
            console.error('A lista não pode ser gravada dentro do repositório. Use um caminho fora dele.');
            process.exit(2);
        }
    }
    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI não definida.');
        process.exit(2);
    }

    await mongoose.connect(process.env.MONGODB_URI, {
        dbName: process.env.MONGODB_DB_NAME || undefined,
    });
    try {
        const r = await regenerarCodigosDeAlunos({ aplicar, somenteSemVinculo, escolaId });
        console.log(`\nAlunos no alvo: ${r.total}`, r.porEscola);
        if (!r.aplicado) {
            console.log('Simulação: nada foi alterado. Rode com --aplicar para trocar os códigos.');
            return;
        }
        console.log(`✅ Códigos trocados: ${r.trocados}. Registro no AuditLog.`);
        if (saida) {
            fs.writeFileSync(path.resolve(saida), csv(r.lista), 'utf8');
            console.log(`Lista gravada em ${path.resolve(saida)} — contém credenciais; apague depois de entregar.`);
        } else {
            console.log('Os códigos novos aparecem na tela "Códigos secretos" da secretaria.');
        }
    } finally {
        await mongoose.disconnect();
    }
}

main().catch((e) => {
    console.error('Falha:', e.message);
    process.exit(1);
});
