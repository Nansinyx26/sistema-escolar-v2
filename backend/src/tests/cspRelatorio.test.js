/**
 * cspRelatorio.test.js — Issue #613 (épico #612)
 *
 * Antes de trocar `script-src-attr 'unsafe-inline'` por `'none'`, a mesma
 * restrição roda em modo relatório: o navegador não bloqueia nada e avisa cada
 * handler inline que seria barrado. O aviso é registrado só com caminhos — a
 * URL da página pode trazer dado pessoal na query.
 */
const request = require('supertest');
const app = require('../app');
const logger = require('../utils/logger');
const { resumir } = require('../middleware/cspRelatorio');

let aviso;
beforeEach(() => {
    aviso = jest.spyOn(logger, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    aviso.mockRestore();
});

const violacoes = () => aviso.mock.calls.filter(([, meta]) => meta?.action === 'csp.violacao');

describe('política em modo relatório', () => {
    it.each(['/index.html', '/html/login.html', '/api/ping'])(
        '%s traz a política sem handler inline',
        async (caminho) => {
            const res = await request(app).get(caminho);

            const relatorio = res.headers['content-security-policy-report-only'];
            expect(relatorio).toContain("script-src-attr 'none'");
            expect(relatorio).toContain('report-uri /api/csp-relatorio');
        }
    );

    it('a política de verdade continua como estava até o épico terminar', async () => {
        const res = await request(app).get('/index.html');

        expect(res.headers['content-security-policy']).toContain("script-src-attr 'unsafe-inline'");
    });
});

describe('POST /api/csp-relatorio', () => {
    const formatoAntigo = {
        'csp-report': {
            'document-uri': 'https://escola.test/html/cadastro-aluno.html?email=mae%40familia.test',
            'violated-directive': "script-src-attr 'none'",
            'effective-directive': 'script-src-attr',
            'blocked-uri': 'inline',
            'source-file': 'https://escola.test/js/cadastro-aluno.js?v=2',
            'line-number': 120,
        },
    };

    it('aceita o formato do report-uri sem token CSRF e registra só os caminhos', async () => {
        const res = await request(app)
            .post('/api/csp-relatorio')
            .set('Content-Type', 'application/csp-report')
            .send(JSON.stringify(formatoAntigo));

        expect(res.status).toBe(204);
        expect(violacoes()).toHaveLength(1);
        const [, meta] = violacoes()[0];
        expect(meta).toMatchObject({
            pagina: '/html/cadastro-aluno.html',
            diretiva: 'script-src-attr',
            arquivo: '/js/cadastro-aluno.js',
            linha: 120,
        });
        expect(JSON.stringify(meta)).not.toContain('familia.test');
    });

    it('aceita o formato da Reporting API, em lote', async () => {
        const lote = [
            {
                type: 'csp-violation',
                body: {
                    documentURL: 'https://escola.test/html/admin/usuarios.html',
                    effectiveDirective: 'script-src-attr',
                    sourceFile: 'https://escola.test/html/admin/usuarios.html',
                    lineNumber: 40,
                },
            },
            {
                type: 'csp-violation',
                body: {
                    documentURL: 'https://escola.test/html/turma.html',
                    effectiveDirective: 'script-src-attr',
                },
            },
        ];

        const res = await request(app)
            .post('/api/csp-relatorio')
            .set('Content-Type', 'application/reports+json')
            .send(JSON.stringify(lote));

        expect(res.status).toBe(204);
        expect(violacoes().map(([, m]) => m.pagina)).toEqual([
            '/html/admin/usuarios.html',
            '/html/turma.html',
        ]);
    });

    it('corpo que não é relatório não vira registro', async () => {
        const res = await request(app)
            .post('/api/csp-relatorio')
            .set('Content-Type', 'application/json')
            .send({ qualquer: 'coisa' });

        expect(res.status).toBe(204);
        expect(violacoes()).toHaveLength(0);
    });

    it('corpo grande é recusado antes de ser lido', async () => {
        const res = await request(app)
            .post('/api/csp-relatorio')
            .set('Content-Type', 'application/csp-report')
            .send(JSON.stringify({ 'csp-report': { lixo: 'x'.repeat(40 * 1024) } }));

        expect(res.status).toBe(413);
        expect(violacoes()).toHaveLength(0);
    });
});

describe('resumir', () => {
    it('limita o tamanho e descarta o que não é URL', () => {
        const r = resumir({
            'csp-report': {
                'document-uri': `/html/${'a'.repeat(500)}.html`,
                'effective-directive': 'x'.repeat(200),
                'source-file': 'inline',
            },
        });

        expect(r.pagina.length).toBeLessThanOrEqual(200);
        expect(r.diretiva).toHaveLength(64);
        expect(r.arquivo).toBe('inline');
    });
});
