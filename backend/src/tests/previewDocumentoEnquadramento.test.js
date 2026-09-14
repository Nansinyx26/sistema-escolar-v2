/**
 * previewDocumentoEnquadramento.test.js
 *
 * O "Visualizar" da tela Autorizações dos Pais abre o documento num <iframe> da
 * própria aplicação. A política global (`frame-ancestors 'none'` +
 * `X-Frame-Options: DENY`) bloqueava esse iframe e o preview ficava em branco,
 * com "Framing ... violates frame-ancestors 'none'" no console.
 *
 * Só a rota de visualizar libera o enquadramento, e só para a mesma origem. O
 * resto do sistema continua sem poder ser enquadrado.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

beforeAll(async () => {
    await conectarBanco();
});

afterEach(async () => {
    await limparBanco();
});

afterAll(async () => {
    await desconectarBanco();
});

function cookieDe(user) {
    const token = jwt.sign(
        {
            id: user._id.toString(),
            perfil: user.perfil,
            email: user.email,
            nome: user.nome,
            escolaId: user.escolaId,
            purpose: 'session',
        },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
    return `escola_jwt=${token}`;
}

function diretiva(res, nome) {
    const csp = res.headers['content-security-policy'] || '';
    return new RegExp(`(?:^|;)\\s*${nome} ([^;]*)`).exec(csp)?.[1] || '';
}

const DOC_INEXISTENTE = '65f0000000000000000000ff';

describe('preview de documento do responsável num iframe', () => {
    let cookie;

    beforeEach(async () => {
        const secretaria = await criarUsuario({
            perfil: 'secretaria',
            email: 'secretaria.preview@escola.test',
            escolaId: 'escola-preview',
        });
        cookie = cookieDe(secretaria);
    });

    it("visualizar pode ser enquadrado pela mesma origem (frame-ancestors 'self')", async () => {
        const res = await request(app)
            .get(`/api/documentos-responsaveis/${DOC_INEXISTENTE}/visualizar`)
            .set('Cookie', cookie);

        // O erro também abre no iframe: é assim que a tela lê a mensagem.
        expect(res.status).toBe(404);
        expect(diretiva(res, 'frame-ancestors')).toBe("'self'");
        expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    });

    it('o resto da CSP continua valendo na rota de visualizar', async () => {
        const res = await request(app)
            .get(`/api/documentos-responsaveis/${DOC_INEXISTENTE}/visualizar`)
            .set('Cookie', cookie);

        expect(diretiva(res, 'default-src')).toContain("'self'");
        expect(diretiva(res, 'object-src')).toContain("'none'");
        expect(diretiva(res, 'script-src')).not.toMatch(/'unsafe-inline'/);
    });

    it('as outras rotas seguem sem poder ser enquadradas', async () => {
        const download = await request(app)
            .get(`/api/documentos-responsaveis/${DOC_INEXISTENTE}/download`)
            .set('Cookie', cookie);
        expect(diretiva(download, 'frame-ancestors')).toBe("'none'");
        expect(download.headers['x-frame-options']).toBe('DENY');

        const pagina = await request(app).get('/index.html');
        expect(diretiva(pagina, 'frame-ancestors')).toBe("'none'");
        expect(pagina.headers['x-frame-options']).toBe('DENY');
    });
});
