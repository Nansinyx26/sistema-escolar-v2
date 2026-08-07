/**
 * paginasAdminBypass.test.js
 * Suite — tentativas de contornar o gate das áreas restritas pela URL.
 *
 * O gate de /html/admin depende de o Express casar o prefixo da rota ANTES do
 * express.static. Toda a família de ataques abaixo ataca justamente esse
 * casamento: se alguma variação da URL chega no static sem passar pelo gate, o
 * arquivo sai inteiro para um anônimo. São falhas clássicas e silenciosas —
 * a aplicação continua funcionando normalmente enquanto vaza pela porta lateral.
 */
const request = require('supertest');
const app = require('../app');

// Marcador que só existe dentro da página protegida. Se aparecer no corpo de
// qualquer resposta abaixo, o conteúdo vazou — independente do status.
const MARCADOR = 'Administrador</option>';

function vazou(res) {
    return typeof res.text === 'string' && res.text.includes(MARCADOR);
}

describe('Bypass do gate: variações de caminho', () => {
    const VARIACOES = [
        // Caixa: o roteamento do Express é case-insensitive por padrão, mas o
        // express.static no Windows resolve o arquivo mesmo com outra caixa.
        // Se o gate casasse com caixa e o static não, abriria o buraco.
        '/HTML/ADMIN/usuarios.html',
        '/Html/Admin/Usuarios.html',
        '/html/ADMIN/usuarios.html',

        // Travessia que volta para a área protegida por fora dela.
        '/html/secretaria/../admin/usuarios.html',
        '/html/../html/admin/usuarios.html',
        '/css/../html/admin/usuarios.html',

        // Barras duplicadas e caminho vazio.
        '//html/admin/usuarios.html',
        '/html//admin/usuarios.html',
        '/html/./admin/usuarios.html',

        // Codificação percentual do prefixo protegido.
        '/html/%61dmin/usuarios.html',
        '/html/ad%6Din/usuarios.html',
        '/%68tml/admin/usuarios.html',

        // Barra codificada — clássico para escapar do casamento de prefixo.
        '/html%2Fadmin%2Fusuarios.html',
        '/html/admin%2Fusuarios.html',

        // Sufixos que o Windows historicamente aceita como o mesmo arquivo.
        '/html/admin/usuarios.html.',
        '/html/admin/usuarios.html%20',
        '/html/admin/usuarios.html::$DATA',
    ];

    it.each(VARIACOES)('anonimo NAO obtem o conteudo via %s', async (url) => {
        const res = await request(app).get(url);

        // O que importa não é o status e sim o corpo: 200 com o conteúdo é a
        // falha real. 302, 404 ou 400 são todos desfechos aceitáveis.
        expect(vazou(res)).toBe(false);
        expect(res.status).not.toBe(200);
    });
});

describe('Bypass do gate: outras rotas para o mesmo arquivo', () => {
    it('a area nao e alcancavel pela raiz do site', async () => {
        const res = await request(app).get('/admin/usuarios.html');
        expect(vazou(res)).toBe(false);
    });

    it('nao ha static de raiz servindo a arvore inteira', async () => {
        // Se existisse `express.static(frontendRootPath)` na raiz, este caminho
        // devolveria o arquivo sem passar por gate nenhum.
        const res = await request(app).get('/backend/.env.example');
        expect(res.status).not.toBe(200);
    });

    it('o catch-all de 404 nao entrega a pagina protegida', async () => {
        const res = await request(app).get('/qualquer/coisa/html/admin/usuarios.html');
        expect(vazou(res)).toBe(false);
    });
});

describe('Bypass do gate: métodos e cabeçalhos', () => {
    it('HEAD tambem e barrado', async () => {
        const res = await request(app).head('/html/admin/usuarios.html');
        expect(res.status).not.toBe(200);
    });

    it('POST na pagina protegida nao devolve o conteudo', async () => {
        const res = await request(app).post('/html/admin/usuarios.html');
        expect(vazou(res)).toBe(false);
    });

    it('X-Forwarded-For nao influencia a autorizacao', async () => {
        const res = await request(app)
            .get('/html/admin/usuarios.html')
            .set('X-Forwarded-For', '127.0.0.1');
        expect(vazou(res)).toBe(false);
    });

    it('cabecalho de perfil forjado e ignorado', async () => {
        // O perfil vem do banco via JWT; nenhum cabeçalho pode injetá-lo.
        const res = await request(app)
            .get('/html/admin/usuarios.html')
            .set('X-User-Perfil', 'admin')
            .set('perfil', 'admin');
        expect(vazou(res)).toBe(false);
    });

    it('JWT sem assinatura (alg=none) nao passa', async () => {
        // Payload válido, algoritmo "none": o ataque clássico contra
        // verificação de JWT mal configurada.
        const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({
            id: '000000000000000000000000', perfil: 'admin', tokenVersion: 0,
        })).toString('base64url');

        const res = await request(app)
            .get('/html/admin/usuarios.html')
            .set('Cookie', [`escola_jwt=${header}.${payload}.`]);

        expect(vazou(res)).toBe(false);
        expect(res.status).toBe(302);
    });

    it('JWT assinado com outro segredo nao passa', async () => {
        const jwt = require('jsonwebtoken');
        const token = jwt.sign(
            { id: '000000000000000000000000', perfil: 'admin', tokenVersion: 0 },
            'segredo-errado-do-atacante',
            { expiresIn: '1h' }
        );

        const res = await request(app)
            .get('/html/admin/usuarios.html')
            .set('Cookie', [`escola_jwt=${token}`]);

        expect(vazou(res)).toBe(false);
        expect(res.status).toBe(302);
    });
});
