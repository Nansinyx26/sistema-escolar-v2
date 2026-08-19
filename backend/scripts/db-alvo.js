#!/usr/bin/env node
/**
 * db-alvo.js — executa um script npm contra um banco escolhido EXPLICITAMENTE.
 *
 * Uso:
 *   npm run db:producao -- migrate:up          → recusa, e explica o que falta
 *   CONFIRMO=producao npm run db:producao -- migrate:up   → executa
 *
 * O padrão de TODO o resto do projeto continua sendo `backend/.env`, que aponta
 * para o banco de desenvolvimento. Este script é o único caminho para produção,
 * e ele lê `backend/.env.producao` — arquivo que nenhum outro comando carrega.
 *
 * A decisão de liberar ou barrar vive em `src/utils/alvoBanco.js`, separada de
 * propósito: assim a trava tem teste unitário sem precisar de banco.
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const { avaliarAlvo, formatarResumo } = require('../src/utils/alvoBanco');

const RAIZ = path.join(__dirname, '..');
const ARQUIVOS_POR_ALVO = {
    producao: '.env.producao',
    desenvolvimento: '.env',
};

function main() {
    const alvo = process.argv[2];
    const comando = process.argv.slice(3);

    if (!ARQUIVOS_POR_ALVO[alvo] || comando.length === 0) {
        console.error('Uso: node scripts/db-alvo.js <producao|desenvolvimento> <script-npm> [args]');
        console.error('Ex.: CONFIRMO=producao npm run db:producao -- migrate:up');
        process.exit(2);
    }

    const arquivo = path.join(RAIZ, ARQUIVOS_POR_ALVO[alvo]);
    if (!fs.existsSync(arquivo)) {
        console.error(`\n❌ Arquivo de ambiente não encontrado: ${ARQUIVOS_POR_ALVO[alvo]}`);
        if (alvo === 'producao') {
            console.error('   Copie backend/.env.producao.example e preencha a MONGODB_URI de produção.');
            console.error('   Ele é ignorado pelo git — nunca deve ser commitado.\n');
        }
        process.exit(2);
    }

    // Carrega o ambiente do alvo SEM contaminar o processo atual mais do que o
    // necessário: o que for para o filho é montado explicitamente abaixo.
    const ambiente = {};
    require('dotenv').config({ path: arquivo, processEnv: ambiente });

    const decisao = avaliarAlvo({
        alvo,
        confirmacao: process.env.CONFIRMO,
        uri: ambiente.MONGODB_URI,
        dbName: ambiente.MONGODB_DB_NAME,
    });

    console.log(formatarResumo(decisao.resumo));

    if (!decisao.ok) {
        console.error(`❌ ${decisao.motivo}\n`);
        process.exit(1);
    }

    console.log(`▶  npm run ${comando.join(' ')}\n`);

    const resultado = spawnSync('npm', ['run', ...comando], {
        cwd: RAIZ,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: { ...process.env, ...ambiente },
    });

    process.exit(resultado.status === null ? 1 : resultado.status);
}

main();
