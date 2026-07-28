/**
 * consoleGuard — garante que o `console.*` legado não seja um buraco no
 * Data Masking. Enquanto existir console.* não migrado, é este teste que
 * assegura que ele sai sanitizado, com nível e com contexto.
 */

const consoleGuard = require('../utils/consoleGuard');
const logContext = require('../utils/logContext');

/**
 * Captura stdout+stderr enquanto `fn` roda.
 *
 * Falha explicitamente se nada for capturado: uma captura vazia faria todas as
 * asserções do tipo `not.toContain(segredo)` passarem por vacuidade — que é
 * exatamente o falso positivo que estes testes existem para impedir.
 */
function capturar(fn) {
    const linhas = [];
    const orig = [process.stdout.write, process.stderr.write];
    const patch = (s) => { s.write = (c) => { linhas.push(String(c)); return true; }; };
    patch(process.stdout);
    patch(process.stderr);
    try { fn(); } finally {
        process.stdout.write = orig[0];
        process.stderr.write = orig[1];
    }
    const saida = linhas.join('');
    if (!saida.trim()) {
        throw new Error('Nada foi capturado do stdout/stderr — o teste seria vacuamente verdadeiro.');
    }
    return saida;
}

function parseLinhas(saida) {
    return saida.split('\n')
        .filter(l => l.trim().startsWith('{'))
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
}

describe('consoleGuard — normalização de argumentos', () => {
    it('separa mensagem, Error e objeto de contexto', () => {
        const err = new Error('boom');
        const { mensagem, meta } = consoleGuard.normalizar(['Falhou:', err, { alunoId: 7 }]);
        expect(mensagem).toBe('Falhou:');
        expect(meta.err).toBe(err);
        expect(meta.alunoId).toBe(7);
    });

    it('não perde argumentos extras', () => {
        const { meta } = consoleGuard.normalizar(['x', { a: 1 }, { b: 2 }]);
        expect(meta.a).toBe(1);
        expect(meta.arg1).toEqual({ b: 2 });
    });

    it('lida com chamada sem argumentos', () => {
        expect(consoleGuard.normalizar([]).mensagem).toBe('(sem mensagem)');
    });
});

describe('consoleGuard — redirecionamento', () => {
    beforeAll(() => consoleGuard.instalar());
    afterAll(() => consoleGuard.desinstalar());

    it('console.error vira nível error em JSON', () => {
        const linhas = parseLinhas(capturar(() => console.error('falha grave')));
        const l = linhas.find(o => o.message === 'falha grave');
        expect(l).toBeDefined();
        expect(l.level).toBe('error');
        expect(l.viaConsole).toBe(true);
    });

    it('console.warn e console.log recebem níveis distintos', () => {
        const linhas = parseLinhas(capturar(() => {
            console.warn('atencao');
            console.log('informativo');
        }));
        expect(linhas.find(o => o.message === 'atencao').level).toBe('warn');
        expect(linhas.find(o => o.message === 'informativo').level).toBe('info');
    });

    it('SANITIZA senha passada por console.log legado', () => {
        const saida = capturar(() => {
            console.log('login recebido', { email: 'ana@escola.com', senha: 'Secreta#123' });
        });
        expect(saida).not.toContain('Secreta#123');
        expect(saida).not.toContain('ana@escola.com');
        expect(saida).toContain('[REDACTED]');
    });

    it('SANITIZA segredo embutido no meio da string', () => {
        const saida = capturar(() => {
            console.error('payload invalido: senha=AbC123xyz');
        });
        expect(saida).not.toContain('AbC123xyz');
    });

    it('herda o contexto da requisição em andamento', () => {
        const saida = capturar(() => {
            logContext.run({ requestId: 'rq-1', userId: 'us-1', escolaId: 'esc-1' }, () => {
                console.error('erro dentro da requisicao');
            });
        });
        const l = parseLinhas(saida).find(o => o.message === 'erro dentro da requisicao');
        expect(l.requestId).toBe('rq-1');
        expect(l.userId).toBe('us-1');
        expect(l.escolaId).toBe('esc-1');
    });

    it('registra a origem para orientar a migração, quando o stack permite', () => {
        const l = parseLinhas(capturar(() => console.log('rastrear origem')))
            .find(o => o.message === 'rastrear origem');
        expect(l).toBeDefined();
        // O formato do stack varia conforme o runner (o Jest interpõe frames
        // próprios), então exige-se apenas que, existindo, aponte arquivo:linha.
        if (l.origem !== undefined) {
            expect(l.origem).toMatch(/\.js:\d+$/);
        }
    });

    it('desinstalar restaura o console nativo', () => {
        consoleGuard.desinstalar();
        expect(console._nativo).toBeUndefined();
        consoleGuard.instalar();
    });
});
