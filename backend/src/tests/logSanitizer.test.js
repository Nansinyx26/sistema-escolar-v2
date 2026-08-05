/**
 * Data Masking dos logs — rede de segurança contra regressão.
 *
 * A regra que estes testes protegem é simples e não-negociável:
 * nenhuma credencial ou dado pessoal de aluno pode chegar ao destino do log.
 * Se alguém afrouxar o sanitizador, é aqui que o CI acusa.
 */

const {
    sanitize, scrubString, maskEmail, maskDocument, maskName,
} = require('../utils/logSanitizer');

describe('logSanitizer — segredos por nome de chave', () => {
    it('remove senha em todas as variações de nome', () => {
        const out = sanitize({
            senha: 'MinhaSenh@123',
            novaSenha: 'Outra1',
            senha_atual: 'Antiga1',
            'user-password': 'x',
            passwordHash: 'abc',
        });
        expect(JSON.stringify(out)).not.toMatch(/MinhaSenh|Outra1|Antiga1/);
        expect(out.senha).toBe('[REDACTED]');
        expect(out.novaSenha).toBe('[REDACTED]');
        expect(out.senha_atual).toBe('[REDACTED]');
        expect(out.passwordHash).toBe('[REDACTED]');
    });

    it('remove tokens, cookies e segredos de infraestrutura', () => {
        const out = sanitize({
            accessToken: 'a.b.c',
            refreshToken: 'd.e.f',
            authorization: 'Bearer xyz',
            cookie: 'sid=1',
            JWT_SECRET: 'supersecreto',
            MONGODB_URI: 'mongodb://u:p@h/db',
            codigoSecreto: 'ABC123',
            twoFactorPendingToken: 'hash',
        });
        for (const v of Object.values(out)) expect(v).toBe('[REDACTED]');
    });

    it('preserva campos operacionais úteis ao diagnóstico', () => {
        const out = sanitize({ escolaId: 'esc-1', perfil: 'professor', status: 500, turma: '5A' });
        expect(out).toEqual({ escolaId: 'esc-1', perfil: 'professor', status: 500, turma: '5A' });
    });
});

describe('logSanitizer — PII de alunos (LGPD)', () => {
    it('mascara e-mail preservando forma diagnosticável', () => {
        expect(maskEmail('joao.silva@gmail.com')).toBe('j***@g***.com');
        // Domínio composto mantém só o TLD real (.br) — suficiente para separar
        // e-mail de escola de e-mail pessoal, sem reconstituir o endereço.
        expect(sanitize({ email: 'ana@escola.com.br' }).email).toBe('a***@e***.br');
    });

    it('mascara CPF mantendo apenas os 2 últimos dígitos', () => {
        expect(maskDocument('111.444.777-35')).toBe('***35');
        expect(sanitize({ cpf: '11144477735' }).cpf).toBe('***35');
    });

    it('reduz nome de aluno a iniciais', () => {
        expect(maskName('Maria Aparecida Souza')).toBe('M. A. S.');
        expect(sanitize({ nome: 'Pedro Lima' }).nome).toBe('P. L.');
    });
});

describe('logSanitizer — segredos embutidos em texto livre', () => {
    it('remove JWT solto numa mensagem de erro', () => {
        const s = scrubString('falha: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdef123456 expirado');
        expect(s).not.toMatch(/eyJhbGciOiJIUzI1NiJ9/);
        expect(s).toMatch(/JWT_REDACTED/);
    });

    it('remove senha de connection string', () => {
        expect(scrubString('mongodb+srv://admin:P4ssw0rd@cluster0.net/db')).not.toMatch(/P4ssw0rd/);
    });

    it('remove atribuições inline (senha=, token:)', () => {
        expect(scrubString('body: senha=Segredo123&x=1')).not.toMatch(/Segredo123/);
    });

    it('remove CPF e e-mail de texto livre', () => {
        expect(scrubString('aluno 123.456.789-11 nao achado')).not.toMatch(/123\.456\.789-11/);
        expect(scrubString('envio para maria@escola.com falhou')).not.toMatch(/maria@escola\.com/);
    });

    it('não altera texto operacional legítimo', () => {
        expect(scrubString('Turma 5A criada com sucesso')).toBe('Turma 5A criada com sucesso');
    });
});

describe('logSanitizer — Error', () => {
    it('preserva stack e code, sanitiza a mensagem', () => {
        const err = new Error('login de joao@x.com com senha=Abc123 falhou');
        err.code = 'EAUTH';
        const out = sanitize(err);

        expect(out.name).toBe('Error');
        expect(out.code).toBe('EAUTH');
        expect(typeof out.stack).toBe('string');
        expect(out.message).not.toMatch(/Abc123/);
        expect(out.message).not.toMatch(/joao@x\.com/);
    });
});

describe('logSanitizer — robustez (não pode derrubar o processo)', () => {
    it('lida com referência circular', () => {
        const o = { a: 1 };
        o.self = o;
        expect(sanitize(o).self).toBe('[Circular]');
    });

    it('limita profundidade', () => {
        let deep = { fim: true };
        for (let i = 0; i < 30; i++) deep = { n: deep };
        expect(JSON.stringify(sanitize(deep))).toMatch(/profundidade máxima/);
    });

    it('trunca arrays e strings gigantes', () => {
        expect(sanitize(new Array(300).fill('x')).length).toBe(51);
        expect(sanitize('y'.repeat(9000)).length).toBeLessThan(2100);
    });

    it('não serializa conteúdo de Buffer', () => {
        expect(sanitize({ b: Buffer.from('segredo') }).b).toMatch(/^\[Buffer: \d+ bytes\]$/);
    });

    it('não muta o objeto original', () => {
        const original = { senha: 'abc', nome: 'Ana Lima' };
        sanitize(original);
        expect(original.senha).toBe('abc');
        expect(original.nome).toBe('Ana Lima');
    });

    it('aceita null e undefined', () => {
        expect(sanitize(null)).toBeNull();
        expect(sanitize(undefined)).toBeUndefined();
    });
});

describe('logger — contexto automático e níveis', () => {
    const logger = require('../utils/logger');
    const logContext = require('../utils/logContext');

    it('expõe os cinco níveis e alert', () => {
        for (const m of ['debug', 'info', 'warn', 'error', 'fatal', 'alert']) {
            expect(typeof logger[m]).toBe('function');
        }
    });

    it('propaga requestId/userId/escolaId para dentro do escopo', () => {
        logContext.run({ requestId: 'r1', userId: 'u1', escolaId: 'e1' }, () => {
            expect(logContext.get()).toMatchObject({ requestId: 'r1', userId: 'u1', escolaId: 'e1' });
        });
    });

    it('não vaza contexto para fora do escopo', () => {
        logContext.run({ requestId: 'r2' }, () => {});
        expect(logContext.get().requestId).toBeUndefined();
    });

    it('setAction enriquece o contexto em andamento', () => {
        logContext.run({ requestId: 'r3' }, () => {
            logContext.setAction('nota.lancar');
            expect(logContext.get().action).toBe('nota.lancar');
        });
    });

    it('gera requestId com entropia suficiente', () => {
        const ids = new Set(Array.from({ length: 1000 }, () => logContext.generateRequestId()));
        expect(ids.size).toBe(1000);
    });
});
