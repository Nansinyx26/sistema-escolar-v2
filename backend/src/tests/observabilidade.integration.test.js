/**
 * Observabilidade ponta a ponta — valida o comportamento no ciclo HTTP real,
 * não só as funções isoladas.
 *
 * O que precisa ser verdade depois de uma requisição:
 *   1. o cliente recebe um X-Request-Id para referenciar o incidente;
 *   2. o log de acesso sai em JSON com o mesmo requestId;
 *   3. um login com senha errada não deixa a senha em lugar nenhum do log.
 */

const request = require('supertest');
const app = require('../app');

/** Captura o que o processo escreveu em stdout+stderr durante `fn`. */
async function capturarLogs(fn) {
    const linhas = [];
    const originais = [process.stdout.write, process.stderr.write];
    const patch = (s) => { s.write = (chunk) => { linhas.push(String(chunk)); return true; }; };

    patch(process.stdout);
    patch(process.stderr);
    try {
        await fn();
    } finally {
        process.stdout.write = originais[0];
        process.stderr.write = originais[1];
    }

    const saida = linhas.join('');
    // Sem esta guarda, uma captura vazia faria os testes de vazamento
    // (`not.toContain(senha)`) passarem sem terem verificado nada.
    if (!saida.trim()) {
        throw new Error('Nada foi capturado do stdout/stderr — o teste seria vacuamente verdadeiro.');
    }
    return saida;
}

describe('Observabilidade — ciclo HTTP', () => {
    it('devolve X-Request-Id ao cliente', async () => {
        const res = await request(app).get('/api/usuarios');
        expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{16}$/);
    });

    it('emite log de acesso em JSON com o mesmo requestId da resposta', async () => {
        let res;
        const saida = await capturarLogs(async () => {
            res = await request(app).get('/api/usuarios');
            // o log sai no evento 'finish' — deixa o event loop girar
            await new Promise(r => setImmediate(r));
        });

        const requestId = res.headers['x-request-id'];
        const linha = saida.split('\n')
            .filter(l => l.trim().startsWith('{'))
            .map(l => { try { return JSON.parse(l); } catch { return null; } })
            .find(o => o && o.requestId === requestId);

        expect(linha).toBeDefined();
        expect(linha.level).toBeDefined();
        expect(linha.timestamp).toBeDefined();
        expect(linha.method).toBe('GET');
        expect(typeof linha.durationMs).toBe('number');
        expect(linha.status).toBe(res.status);
    });

    it('NUNCA grava a senha enviada num login inválido', async () => {
        const SENHA = 'SenhaSuperSecreta#2026';

        const saida = await capturarLogs(async () => {
            await request(app)
                .post('/api/usuarios/login')
                .send({ email: 'inexistente@escola.com', senha: SENHA });
            await new Promise(r => setImmediate(r));
        });

        expect(saida).not.toContain(SENHA);
        expect(saida).not.toContain('inexistente@escola.com');
    });

    it('não vaza o header Authorization nos logs', async () => {
        const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6ImZha2UifQ.assinaturaFalsa123';

        const saida = await capturarLogs(async () => {
            await request(app).get('/api/usuarios').set('Authorization', `Bearer ${TOKEN}`);
            await new Promise(r => setImmediate(r));
        });

        expect(saida).not.toContain(TOKEN);
    });
});
