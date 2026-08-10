/**
 * migrations.test.js — o runner de migrations, verificado.
 *
 * Contexto (Issue #1): este runner existia em src/database/DatabaseMigrations.js
 * e NUNCA rodou uma vez sequer. O `npm run migrate` apontava para uma importação
 * one-shot de IndexedDB, e a CLI daqui quebrava em MODULE_NOT_FOUND antes da
 * primeira linha útil. Enquanto isso, toda push na develop reexecutava aquela
 * importação contra o banco de dev.
 *
 * O que precisa ser verdade, e por quê:
 *   1. Migração pendente é aplicada e fica registrada em `__migrations__`
 *   2. Rodar de novo NÃO reaplica — é o que separa um runner de um script solto
 *   3. Migração que falha é reportada como falha, e o CI precisa ver isso
 *   4. `down` reverte e devolve a migração ao estado de pendente
 */

const path = require('node:path');
const fs = require('node:fs');
const mongoose = require('mongoose');

const { DatabaseMigrations } = require('../database/DatabaseMigrations');
const { conectarBanco, desconectarBanco } = require('./helpers');

/** Diretório isolado: os testes não podem depender das migrações reais. */
const DIR_TEMP = path.join(__dirname, '__migrations-teste__');

/** Nome único por teste evita colisão no registro entre casos. */
let contador = 0;
function escreverMigration(corpo) {
    contador += 1;
    const nome = `${1000000000000 + contador}-teste.js`;
    fs.writeFileSync(path.join(DIR_TEMP, nome), corpo, 'utf8');
    return nome;
}

describe('runner de migrations', () => {
    let runner;

    beforeAll(async () => {
        await conectarBanco();
        fs.mkdirSync(DIR_TEMP, { recursive: true });
    });

    beforeEach(async () => {
        for (const f of fs.readdirSync(DIR_TEMP)) {
            fs.unlinkSync(path.join(DIR_TEMP, f));
        }
        // O registro precisa começar limpo: um teste não pode ver o que outro
        // aplicou, senão "pendente" deixa de significar alguma coisa.
        await mongoose.connection.collection('__migrations__').deleteMany({});
        runner = new DatabaseMigrations(DIR_TEMP);
    });

    afterAll(async () => {
        fs.rmSync(DIR_TEMP, { recursive: true, force: true });
        await desconectarBanco();
    });

    test('aplica a migração pendente e a registra', async () => {
        const nome = escreverMigration(`
            module.exports = {
                version: '1.0',
                async up() { return { ok: true }; },
                async down() { return { ok: true }; },
            };
        `);

        await expect(runner.getPendingMigrations()).resolves.toHaveLength(1);

        const resultado = await runner.runPending();

        expect(resultado.applied).toBe(1);
        expect(resultado.failed).toBe(0);

        const status = await runner.status();
        expect(status.applied).toBe(1);
        expect(status.pending).toBe(0);
        expect(status.appliedMigrations.map((m) => m.name)).toContain(nome);
    });

    test('rodar de novo não reaplica — é idempotente', async () => {
        escreverMigration(`
            module.exports = {
                version: '1.0',
                async up() { return { ok: true }; },
                async down() {},
            };
        `);

        await runner.runPending();
        const segunda = await runner.runPending();

        // Sem isto, cada deploy repetiria toda a história de migrações do
        // projeto contra o banco — que é exatamente o defeito da Issue #1.
        expect(segunda.applied).toBe(0);
        expect(segunda.failed).toBe(0);

        const status = await runner.status();
        expect(status.applied).toBe(1);
    });

    test('migração que falha é reportada como falha e não fica registrada', async () => {
        escreverMigration(`
            module.exports = {
                version: '1.0',
                async up() { throw new Error('falha proposital'); },
                async down() {},
            };
        `);

        const resultado = await runner.runPending();

        // A CLI transforma isto em exit code 1; sem essa contagem, o CI
        // aprovaria um deploy cuja migração não passou.
        expect(resultado.failed).toBe(1);
        expect(resultado.applied).toBe(0);

        const status = await runner.status();
        expect(status.applied).toBe(0);
        expect(status.pending).toBe(1);
    });

    test('para na primeira falha, sem aplicar as seguintes', async () => {
        escreverMigration(`
            module.exports = {
                version: '1.0',
                async up() { throw new Error('quebra aqui'); },
                async down() {},
            };
        `);
        escreverMigration(`
            module.exports = {
                version: '1.0',
                async up() { return { ok: true }; },
                async down() {},
            };
        `);

        const resultado = await runner.runPending();

        // Ordem importa em migração: seguir depois de uma falha deixaria o
        // banco num estado que nenhuma sequência de código produziria.
        expect(resultado.failed).toBe(1);
        expect(resultado.applied).toBe(0);
    });

    test('down reverte e a migração volta a ficar pendente', async () => {
        const nome = escreverMigration(`
            module.exports = {
                version: '1.0',
                async up() { return { ok: true }; },
                async down() { return { revertido: true }; },
            };
        `);

        await runner.runPending();
        const resultado = await runner.revertMigration(nome);

        expect(resultado.success).toBe(true);

        const status = await runner.status();
        expect(status.applied).toBe(0);
        expect(status.pending).toBe(1);
    });

    test('a migração versionada do projeto carrega sem erro de caminho', () => {
        // Regressão direta da Issue #1: a única migração versionada fazia
        // require('../models/Usuario'), caminho que não existe a partir de
        // backend/migrations/. Como o runner nunca rodou, ninguém percebeu.
        const reais = path.join(__dirname, '..', '..', 'migrations');
        const arquivos = fs.readdirSync(reais).filter((f) => f.endsWith('.js'));

        expect(arquivos.length).toBeGreaterThan(0);

        for (const arquivo of arquivos) {
            const mod = require(path.join(reais, arquivo));
            expect(typeof mod.up).toBe('function');
            expect(typeof mod.down).toBe('function');
        }
    });
});
