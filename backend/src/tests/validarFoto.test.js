/**
 * validarFoto.test.js
 *
 * Issue #572: `foto` com aspas fechava o atributo `src` no front e virava
 * handler de evento (XSS armazenado). O backend passa a aceitar só os
 * formatos que uma foto legítima do sistema tem.
 */

const request = require('supertest');
const app = require('../app');
const { fotoValida } = require('../middleware/validarFoto');

const ATAQUES = [
    'x" onerror="fetch(1)',
    "x' onerror='alert(1)",
    'https://lh3.googleusercontent.com/a" onerror="alert(1)',
    'data:image/png;base64,AAAA" onerror="alert(1)',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'javascript:alert(1)',
    'vbscript:msgbox(1)',
    'gridfs:abc def',
    'foto`x`',
    '<img src=x>',
    // Issue #604: endereço de outro servidor só por https de host permitido.
    'https://evil.example.com/rastreio.png',
    'https://lh3.googleusercontent.com.evil.example.com/a.png',
    'http://lh3.googleusercontent.com/a.png',
    'http://evil.example.com/x.png',
    '//evil.example.com/x.png',
    'ftp://evil.example.com/x.png',
];

const LEGITIMOS = [
    '',
    null,
    undefined,
    'gridfs:65f1a2b3c4d5e6f708192a3b',
    '65f1a2b3c4d5e6f708192a3b',
    '/api/files/65f1a2b3c4d5e6f708192a3b',
    'https://lh3.googleusercontent.com/a/ACg8ocK-abc=s96-c',
    'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=',
    'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    'foto_prof_123.webp',
];

describe('fotoValida (Issue #572)', () => {
    it.each(ATAQUES)('recusa %s', (valor) => {
        expect(fotoValida(valor)).toBe(false);
    });

    it.each(LEGITIMOS)('aceita %s', (valor) => {
        expect(fotoValida(valor)).toBe(true);
    });

    describe('URL do próprio sistema (Issue #604)', () => {
        const PROPRIA =
            'https://sistema-escolar-bfty.onrender.com/api/files/65f1a2b3c4d5e6f708192a3b';
        const original = process.env.FRONTEND_URL;
        afterEach(() => {
            if (original === undefined) delete process.env.FRONTEND_URL;
            else process.env.FRONTEND_URL = original;
        });

        it('aceita o host de FRONTEND_URL', () => {
            process.env.FRONTEND_URL = 'https://sistema-escolar-bfty.onrender.com';
            expect(fotoValida(PROPRIA)).toBe(true);
        });

        it('sem FRONTEND_URL, só o Google passa', () => {
            delete process.env.FRONTEND_URL;
            expect(fotoValida(PROPRIA)).toBe(false);
            expect(fotoValida('https://lh5.googleusercontent.com/a/x')).toBe(true);
        });
    });

    it('recusa tipos que não são string', () => {
        expect(fotoValida({ $oid: 'x' })).toBe(false);
        expect(fotoValida(['a'])).toBe(false);
        expect(fotoValida(42)).toBe(false);
    });
});

describe('middleware recusarFotoInvalida nas rotas que gravam foto', () => {
    const ROTAS = [
        ['put', '/api/auth/profile'],
        ['put', '/api/usuarios/65f1a2b3c4d5e6f708192a3b'],
        ['put', '/api/professores/65f1a2b3c4d5e6f708192a3b'],
        ['put', '/api/alunos/65f1a2b3c4d5e6f708192a3b'],
        ['post', '/api/alunos'],
        ['put', '/api/usuarios/foto'],
    ];

    it.each(ROTAS)('%s %s com foto maliciosa → 400 FOTO_INVALIDA', async (metodo, rota) => {
        const res = await request(app)[metodo](rota).send({ foto: 'x" onerror="fetch(1)' });
        expect(res.status).toBe(400);
        expect(res.body.codigo).toBe('FOTO_INVALIDA');
    });

    it('foto legítima segue para a rota (sem sessão → 401, não 400)', async () => {
        const res = await request(app)
            .put('/api/auth/profile')
            .send({ foto: 'gridfs:65f1a2b3c4d5e6f708192a3b' });
        expect(res.status).toBe(401);
    });
});
