/**
 * gateAnonimo.test.js — o que um anônimo alcança (Issue #213).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUE ESTA SUÍTE NÃO USA BANCO
 * ─────────────────────────────────────────────────────────────────────────
 * Toda asserção aqui é sobre requisição SEM sessão, e o gate decide isso antes
 * de consultar o banco: sem token, `autorizar` grava o cookie de destino e
 * redireciona na hora — `sessaoDoRequest` nunca chega a ser chamado. O mesmo
 * vale para o `authJWT` das rotas de API, que devolve 401 antes do controller.
 *
 * Isso não é economia de setup, é o recorte certo: a pergunta desta suíte é
 * "o que o servidor entrega a quem não provou nada", e a resposta não pode
 * depender do estado do banco. Autorização por PERFIL (que precisa ler o
 * usuário) já é coberta por `paginasAdmin.test.js`, que conecta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O DEFEITO QUE ORIGINOU A SUÍTE
 * ─────────────────────────────────────────────────────────────────────────
 * O gate decidia por lista de áreas conhecidas e caía num `next()` seco quando
 * o caminho não casava com nenhuma. Como `AREAS` cobre quatro diretórios e dois
 * arquivos, 18 páginas internas eram servidas em 200 para quem não tem sessão —
 * inclusive `perfil.html`, `meus-dados.html` e os utilitários de manutenção em
 * `/html/utils`. O navegador era barrado por `js/guarda-acesso.js`; um `curl`
 * não era.
 *
 * O teste que faltava é justamente este: o de que o PADRÃO é fechado. Sem ele,
 * uma página nova nasce pública no servidor e nada acusa.
 */
const request = require('supertest');
const app = require('../app');

const LOGIN = '/html/login.html';

/** Todo caminho que o anônimo NÃO pode receber. */
const INTERNAS = [
    // Estavam em 200 antes da correção — o coração da Issue #213.
    '/html/turma.html',
    '/html/perfil.html',
    '/html/meus-dados.html',
    '/html/cadastro-aluno.html',
    '/html/lista-professores.html',
    '/html/planilha-faltas.html',
    '/html/gerenciar-salas.html',
    '/html/grade-horaria-admin.html',
    '/html/ata.html',
    '/html/frequencia-professores.html',
    '/html/meu-horario.html',
    '/html/mudar-senha.html',
    '/html/design-system.html',
    '/html/termo-audio-imagem.html',
    '/detalhes/alunos.html',
    '/detalhes/turmas.html',
    '/detalhes/avaliacoes.html',
    '/graficos/index.html',
    // Utilitários de manutenção: nunca deveriam ter sido públicos.
    '/html/utils/limpar-dados.html',
    '/html/utils/test-backend.html',
    // Áreas que já eram cobertas — aqui para que uma regressão no recorte novo
    // não passe despercebida por só mexer no ramo antigo.
    '/html/dashboard.html',
    '/html/conversas.html',
    '/html/admin/usuarios.html',
    '/html/secretaria/index.html',
    '/html/direcao/index.html',
    '/direcao/codigos-secretos.html',
];

/** O `.js` de uma página interna carrega tanto quanto o `.html` dela. */
const SCRIPTS_INTERNOS = ['/detalhes/alunos.js', '/graficos/graficos.js'];

/** O que precisa continuar aberto — a tela de login depende disto. */
const PUBLICAS = [
    '/',
    '/index.html',
    '/html/login.html',
    '/html/login-diretor.html',
    '/html/login-professor.html',
    '/html/login-secretaria.html',
    '/html/primeiro-acesso.html',
    '/html/reset-password.html',
    '/html/politica-privacidade.html',
    '/html/escolher-perfil.html',
    '/html/selecionar.html',
    '/html/cadastro-diretor.html',
    '/html/cadastro-professor.html',
    '/html/404.html',
    '/html/offline.html',
    '/html/pages/cadastro-responsavel.html',
    '/html/pages/cadastro-docente.html',
    '/html/pages/cadastro-diretor-publico.html',
    '/html/pages/cadastro-secretaria-publico.html',
];

describe('gate de páginas — fecha por omissão para quem não tem sessão', () => {
    it.each(INTERNAS)('%s manda o anônimo para o login', async (caminho) => {
        const res = await request(app).get(caminho);

        expect(res.status).toBe(302);
        expect(res.headers.location).toBe(LOGIN);
    });

    it.each(SCRIPTS_INTERNOS)('%s também é barrado, não só o HTML', async (caminho) => {
        const res = await request(app).get(caminho);

        expect(res.status).toBe(302);
        expect(res.headers.location).toBe(LOGIN);
    });

    it('não devolve o corpo da página junto com o redirecionamento', async () => {
        // Um 302 que ainda carrega o HTML no corpo não protege nada.
        const res = await request(app).get('/html/perfil.html');

        expect(res.text).not.toMatch(/<html/i);
    });

    it('guarda o destino em cookie HttpOnly, não na query do login', async () => {
        // O prefixo secreto da área administrativa não pode aparecer na barra
        // de endereço nem no histórico — ver o bloco em protegerPaginas.js.
        const res = await request(app).get('/html/perfil.html');

        expect(res.headers.location).not.toMatch(/[?&]next=/);
        const cookies = res.headers['set-cookie'] || [];
        const destino = cookies.find((c) => c.startsWith('destino_pos_login='));
        expect(destino).toBeDefined();
        expect(destino).toMatch(/HttpOnly/i);
    });

    it('uma página nova, que ninguém cadastrou, nasce exigindo sessão', async () => {
        const res = await request(app).get('/html/relatorio-que-ainda-nao-existe.html');

        expect(res.status).toBe(302);
        expect(res.headers.location).toBe(LOGIN);
    });
});

describe('gate de páginas — o que continua público', () => {
    it.each(PUBLICAS)('%s segue aberto sem sessão', async (caminho) => {
        const res = await request(app).get(caminho);

        expect(res.status).toBe(200);
    });

    // O fechamento por omissão roda ANTES do express.static e vê toda
    // requisição. Se pegasse asset, a própria tela de login abriria sem estilo —
    // e o sintoma seria uma página quebrada, não um erro.
    it.each([
        '/js/guarda-acesso.js',
        '/js/register.js',
        '/css/main-compiled.css',
        '/manifest.json',
        '/sw.js',
        '/service-worker.js',
        '/favicon.svg',
    ])('%s é asset e não passa pelo gate', async (caminho) => {
        const res = await request(app).get(caminho);

        expect(res.status).toBe(200);
    });
});

describe('gate de páginas — a API não é afetada pelo recorte', () => {
    // O gate é global: um fechamento por omissão sem recorte derrubaria /api
    // inteira. Estas duas asserções são o alarme para isso.
    it('rota pública de API responde normalmente', async () => {
        const res = await request(app).get('/api/ping');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('rota protegida de API segue devolvendo 401, e não um redirecionamento', async () => {
        // 401 e não 302: cliente de API precisa de status, não de tela de login.
        const res = await request(app).get('/api/alunos');

        expect(res.status).toBe(401);
    });
});

describe('gate de páginas — contornos por codificação continuam fechados', () => {
    it.each([
        ['/html/%61dmin/usuarios.html', 'percent-encoding do "a"'],
        ['/html/ad%6Din/usuarios.html', 'percent-encoding do "m"'],
        ['/html/./perfil.html', 'segmento "." no meio do caminho'],
        ['/html/admin/../perfil.html', 'travessia com ".."'],
    ])('%s (%s) não entrega a página', async (caminho) => {
        const res = await request(app).get(caminho);

        expect(res.status).toBe(302);
        expect(res.headers.location).toBe(LOGIN);
    });

    it('barra repetida é canonizada antes de o gate decidir', async () => {
        const res = await request(app).get('/html//perfil.html');

        expect(res.status).toBe(308);
        expect(res.headers.location).toBe('/html/perfil.html');
    });

    it('codificação inválida é rejeitada, nunca tratada como caminho comum', async () => {
        const res = await request(app).get('/html/%ZZ/perfil.html');

        expect(res.status).toBe(400);
    });
});
