/**
 * migrationsCli.test.js — a linha de comando do runner de migrations (Issue #302).
 *
 * O DEFEITO
 * ---------
 * Rodada à mão, a CLI de `src/database/DatabaseMigrations.js` não carregava o
 * `backend/.env` e conectava pelo `connectDB()` da aplicação. Sem URI, ou com a
 * conexão falhando, esse caminho sobe um MongoDB EM MEMÓRIA — a migração
 * "aplicada" num banco descartável relatava sucesso sem tocar no banco real. Em
 * development ainda rodava o seed de teste. E nada impedia `up`/`down` contra o
 * banco de produção (`test`).
 *
 * O QUE ESTE ARQUIVO COBRA
 * ------------------------
 * A CLI real, em processo separado, como o CI e a pessoa no terminal a rodam:
 *   1. sem MONGODB_URI, recusa — nunca usa banco em memória;
 *   2. mostra host e banco antes de agir, sem a senha;
 *   3. `up` no banco de produção (ou em URI sem banco) recusa sem CONFIRMO=producao;
 *   4. conexão que falha, falha — sem fallback;
 *   5. contra um banco de desenvolvimento acessível, `status` funciona;
 *   6. a ajuda continua funcionando sem banco.
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'database', 'DatabaseMigrations.js');
const INALCANCAVEL = '127.0.0.1:1';

/** Roda a CLI com um ambiente controlado. Variáveis ausentes vão como string vazia. */
function rodar(args, env = {}) {
    const r = spawnSync(process.execPath, [CLI, ...args], {
        cwd: path.join(__dirname, '..', '..'),
        env: {
            ...process.env,
            // String vazia, e não ausente: o dotenv só preenche chaves que faltam,
            // então um backend/.env na máquina de quem roda não interfere.
            MONGODB_URI: '',
            MONGODB_DB_NAME: '',
            CONFIRMO: '',
            NODE_ENV: 'test',
            ...env,
        },
        encoding: 'utf8',
        timeout: 60000,
    });
    return { codigo: r.status, saida: `${r.stdout}\n${r.stderr}` };
}

describe('CLI do runner de migrations (Issue #302)', () => {
    it('sem MONGODB_URI, recusa em vez de subir banco em memória', () => {
        const r = rodar(['status']);
        expect(r.codigo).toBe(1);
        expect(r.saida).toMatch(/MONGODB_URI não definida/);
        expect(r.saida).not.toMatch(/MongoDB conectado/);
    });

    it('up no banco de produção sem confirmação recusa antes de conectar, sem mostrar a senha', () => {
        const r = rodar(['up'], {
            MONGODB_URI: `mongodb://usuario:segredo123@${INALCANCAVEL}/test`,
        });
        expect(r.codigo).toBe(1);
        expect(r.saida).toMatch(/PRODUÇÃO/);
        expect(r.saida).toMatch(/CONFIRMO=producao/);
        expect(r.saida).toContain(INALCANCAVEL);
        expect(r.saida).not.toContain('segredo123');
    });

    it('URI sem nome de banco conta como produção: o driver cai no banco `test`', () => {
        const r = rodar(['up'], { MONGODB_URI: `mongodb://${INALCANCAVEL}/` });
        expect(r.codigo).toBe(1);
        expect(r.saida).toMatch(/PRODUÇÃO/);
    });

    it('down no banco de produção sem confirmação também recusa', () => {
        const r = rodar(['down', 'qualquer-migracao'], {
            MONGODB_URI: `mongodb://${INALCANCAVEL}/test`,
        });
        expect(r.codigo).toBe(1);
        expect(r.saida).toMatch(/CONFIRMO=producao/);
    });

    it('conexão que falha, falha: sem fallback para banco em memória', () => {
        const r = rodar(['status'], { MONGODB_URI: `mongodb://${INALCANCAVEL}/escola_dev` });
        expect(r.codigo).toBe(1);
        expect(r.saida).not.toMatch(/Migration Status/);
    }, 60000);

    it('contra um banco de desenvolvimento acessível, status funciona', () => {
        const base = process.env.MONGODB_URI_TEST;
        expect(base).toBeTruthy();
        // A URI do servidor em memória termina em "/", sem banco: nomeia um de desenvolvimento.
        const uri = `${base.replace(/\/[^/]*$/, '')}/escola_dev_cli`;
        const r = rodar(['status'], { MONGODB_URI: uri });
        expect(r.saida).toMatch(/escola_dev_cli/);
        expect(r.saida).toMatch(/Migration Status/);
        expect(r.codigo).toBe(0);
    }, 60000);

    it('sem comando, mostra a ajuda sem precisar de banco', () => {
        const r = rodar([]);
        expect(r.codigo).toBe(0);
        expect(r.saida).toMatch(/Usage/);
    });
});
