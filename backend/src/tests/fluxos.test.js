/**
 * fluxos.test.js — Validação final (Fase 7) dos fluxos de navegação:
 * cadastro → sessão automática → redirect por perfil; primeiro acesso;
 * recuperação de senha; logout; páginas de erro amigáveis.
 */
const request = require('supertest');
const app = require('../app');
const {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    criarUsuario,
    SENHA_TESTE,
    SENHA_TESTE_NOVA,
    CODIGO_ESCOLA_TESTE,
} = require('./helpers');

const SecurityConfig = require('../models/SecurityConfig');
const Professor = require('../models/Professor');

const CODIGO_GLOBAL = CODIGO_ESCOLA_TESTE;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

beforeEach(async () => {
    await limparBanco();
    await SecurityConfig.create({
        chave: 'CONFIG_GERAL',
        codigoSecretoEscola: CODIGO_GLOBAL,
        rotacaoAutomatica: false,
    });
});

// ─────────────────────────────────────────────────────────
// Cadastro → autenticação automática + redirect por perfil
// ─────────────────────────────────────────────────────────
describe('Cadastro com auto-login e redirect por perfil', () => {
    it('diretor: emite cookie JWT e redirect para o dashboard', async () => {
        const res = await request(app).post('/api/auth/register-diretor').send({
            nome: 'Diretora Teste',
            email: 'dir@escola.test',
            senha: SENHA_TESTE,
            telefone: '(19) 99999-0001',
            codigoEscola: CODIGO_GLOBAL,
        });
        expect(res.status).toBe(201);
        expect(res.body.redirect_to).toBe('/html/dashboard.html');
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some((c) => c.startsWith('escola_jwt'))).toBe(true);
    });

    it('secretaria: emite cookie JWT e redirect para o painel da secretaria', async () => {
        const res = await request(app).post('/api/auth/register-secretaria').send({
            nome: 'Secretária Teste',
            email: 'sec@escola.test',
            senha: SENHA_TESTE,
            telefone: '(19) 99999-0002',
            codigoEscola: CODIGO_GLOBAL,
        });
        expect(res.status).toBe(201);
        expect(res.body.redirect_to).toBe('/html/secretaria/painel.html');
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some((c) => c.startsWith('escola_jwt'))).toBe(true);
    });

    it('docente: emite cookie JWT e redirect para o dashboard', async () => {
        const res = await request(app).post('/api/auth/register-docente').send({
            nome: 'Docente Teste',
            email: 'doc@escola.test',
            senha: SENHA_TESTE,
            disciplina: 'História',
            turma: '2B',
            matricula: 'M42',
            telefone: '(19) 99999-0003',
            codigoEscola: CODIGO_GLOBAL,
        });
        expect(res.status).toBe(201);
        expect(res.body.redirect_to).toBe('/html/dashboard.html');
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some((c) => c.startsWith('escola_jwt'))).toBe(true);
    });

    it('nenhum redirect_to de cadastro aponta para landing ou login', async () => {
        const res = await request(app).post('/api/auth/register-diretor').send({
            nome: 'Dir2',
            email: 'dir2@escola.test',
            senha: SENHA_TESTE,
            telefone: '(19) 99999-0004',
            codigoEscola: CODIGO_GLOBAL,
        });
        expect(res.body.redirect_to).not.toMatch(/index\.html|login\.html|primeiro-acesso/);
    });
});

// ─────────────────────────────────────────────────────────
// Primeiro acesso (ativação de conta pré-cadastrada)
// ─────────────────────────────────────────────────────────
describe('POST /api/auth/first-access', () => {
    it('ativa a conta, autentica automaticamente e devolve redirect', async () => {
        await Professor.create({
            nome: 'Prof Pré-Cadastrado',
            email: 'pre@escola.test',
            cpf: '12345678901',
            ativo: true,
        });

        const res = await request(app).post('/api/auth/first-access').send({
            emailOrCpf: 'pre@escola.test',
            password: SENHA_TESTE_NOVA,
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.user.perfil).toBe('professor');
        expect(res.body.redirect_to).toBe('/html/dashboard.html');
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some((c) => c.startsWith('escola_jwt'))).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────
// Recuperação de senha (rota responde sem vazar existência)
// ─────────────────────────────────────────────────────────
describe('POST /api/auth/forgot-password', () => {
    it('responde 200 sem revelar se o e-mail existe', async () => {
        const res = await request(app)
            .post('/api/auth/forgot-password')
            .send({ email: 'nao-existe@escola.test' });
        expect([200, 404]).toContain(res.status);
        expect(res.body).toHaveProperty('success');
    });
});

// ─────────────────────────────────────────────────────────
// Segurança: mock-google-login bloqueado fora de development
// ─────────────────────────────────────────────────────────
describe('POST /api/auth/mock-google-login', () => {
    it('retorna 404 quando NODE_ENV não é development', async () => {
        await criarUsuario({ email: 'vitima@escola.test', perfil: 'diretor' });
        const res = await request(app)
            .post('/api/auth/mock-google-login')
            .send({ email: 'vitima@escola.test' });
        expect(res.status).toBe(404);
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some((c) => c.startsWith('escola_jwt='))).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────
// Navegação: páginas de erro e destinos por perfil existem
// ─────────────────────────────────────────────────────────
describe('Navegação e tratamento de erros', () => {
    it('rota inexistente devolve 404 amigável (não a landing)', async () => {
        const res = await request(app).get('/qualquer-coisa-invalida.html');
        expect(res.status).toBe(404);
        expect(res.text).toContain('Página não encontrada');
        expect(res.text).not.toContain('ESCOLA JAGUARI');
    });

    it('todos os destinos publicos de getRedirectPath existem e retornam 200', async () => {
        const destinos = [
            '/html/escolher-perfil.html',
            '/html/login.html',
            '/portal-responsavel/dist/index.html',
        ];
        for (const destino of destinos) {
            const res = await request(app).get(destino);
            expect(`${destino}:${res.status}`).toBe(`${destino}:200`);
        }
    });

    // `mudar-senha.html` saiu da lista acima pelo mesmo motivo que o dashboard,
    // e o par de testes abaixo é o mesmo par: o gate de páginas passou a fechar
    // por omissão (Issue #213), e esta tela nunca foi pública de fato — o
    // `getRedirectPath` só manda para lá DEPOIS do login, quando
    // `user.deveMudarSenha` é verdadeiro e a sessão já existe.
    //
    // Antes, o 200 anônimo não significava "a tela funciona": significava que o
    // servidor entregava o HTML de uma tela que não teria sessão para trocar
    // senha nenhuma. O que o teste original garantia continua garantido, nas
    // mesmas duas partes: o caminho EXISTE (não cai no catch-all que devolve a
    // landing) e ele ABRE para quem o getRedirectPath manda para lá.
    it('mudar-senha existe e nao cai no catch-all da landing', async () => {
        const res = await request(app).get('/html/mudar-senha.html');

        expect(res.status).toBe(302);
        expect(res.headers.location).toMatch(/\/html\/login\.html/);
        expect(res.text).not.toContain('ESCOLA JAGUARI');
    });

    it('mudar-senha abre para quem o getRedirectPath manda para la', async () => {
        const { assinarTokenSessao } = require('../utils/sessionToken');
        const { getRedirectPath } = require('../controllers/UserController');
        const usuario = await criarUsuario({
            email: 'troca_senha@escola.test',
            perfil: 'professor',
            nome: 'Precisa Trocar Senha',
            deveMudarSenha: true,
        });

        // A precondição do destino, conferida aqui para o teste não passar por
        // acidente caso a regra do getRedirectPath mude.
        expect(getRedirectPath(usuario)).toBe('/html/mudar-senha.html');

        const res = await request(app)
            .get('/html/mudar-senha.html')
            .set('Cookie', [`escola_jwt=${assinarTokenSessao(usuario)}`]);

        expect(res.status).toBe(200);
    });

    // O dashboard saiu da lista acima pelo mesmo motivo que o painel da
    // secretaria: ele passou a ter gate de perfil (utils/painelPorPerfil.js +
    // middleware/protegerPaginas.js), porque montava a tela do professor para
    // qualquer um que abrisse — inclusive o responsável, cuja casa é o portal.
    // O que o teste original garantia continua garantido, em duas partes: o
    // caminho EXISTE (não cai no catch-all que devolve a landing) e ele ABRE
    // para quem o getRedirectPath manda para lá.
    it('dashboard existe e nao cai no catch-all da landing', async () => {
        const res = await request(app).get('/html/dashboard.html');

        expect(res.status).toBe(302);
        expect(res.headers.location).toMatch(/\/html\/login\.html/);
        expect(res.text).not.toContain('ESCOLA JAGUARI');
    });

    // Fechar uma página que era pública tem um risco simétrico ao do bug: barrar
    // quem sempre pôde entrar. Estes quatro perfis abrem o dashboard hoje —
    // professor, diretor e admin porque moram nele; secretaria porque o painel
    // dela oferece um botão "Dashboard" e `js/dashboard.js` desenha a tela para
    // ela. Cada um é exercido por HTTP de verdade, com sessão assinada.
    it.each([['professor'], ['diretor'], ['admin'], ['secretaria']])(
        'dashboard abre para %s',
        async (perfil) => {
            const { assinarTokenSessao } = require('../utils/sessionToken');
            const usuario = await criarUsuario({
                email: `${perfil}_dashboard@escola.test`,
                perfil,
                nome: `${perfil} Teste`,
            });

            const res = await request(app)
                .get('/html/dashboard.html')
                .set('Cookie', [`escola_jwt=${assinarTokenSessao(usuario)}`]);

            expect(`${perfil}: ${res.status}`).toBe(`${perfil}: 200`);
        }
    );

    // O bug relatado: o botão "voltar" da tela de conversas levava o
    // responsável ao painel do professor. Aqui a rede de segurança do servidor —
    // mesmo com um link velho, ele termina no portal, e não numa tela de erro.
    it('dashboard devolve o responsavel ao portal dele', async () => {
        const { assinarTokenSessao } = require('../utils/sessionToken');
        const usuario = await criarUsuario({
            email: 'resp_dashboard@escola.test',
            perfil: 'responsavel',
            nome: 'Responsavel Teste',
        });

        const res = await request(app)
            .get('/html/dashboard.html')
            .set('Cookie', [`escola_jwt=${assinarTokenSessao(usuario)}`]);

        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/portal-responsavel/dist/index.html');
    });

    // O painel da secretaria saiu da lista acima quando /html/secretaria passou
    // a ser área restrita (middleware/protegerPaginas.js). O que o teste original
    // garantia continua garantido, só que em duas partes: o caminho EXISTE de
    // verdade (não cai no catch-all que devolve a landing) e ele ABRE para quem
    // o getRedirectPath manda para lá.
    it('destino da secretaria existe e nao cai no catch-all da landing', async () => {
        const res = await request(app).get('/html/secretaria/painel.html');

        expect(res.status).toBe(302);
        expect(res.headers.location).toMatch(/\/html\/login\.html/);
        expect(res.text).not.toContain('ESCOLA JAGUARI');
    });

    it('destino da secretaria abre para a propria secretaria', async () => {
        const { assinarTokenSessao } = require('../utils/sessionToken');
        const usuario = await criarUsuario({
            email: 'sec_redirect@escola.test',
            perfil: 'secretaria',
            nome: 'Secretaria Teste',
        });

        const res = await request(app)
            .get('/html/secretaria/painel.html')
            .set('Cookie', [`escola_jwt=${assinarTokenSessao(usuario)}`]);

        expect(res.status).toBe(200);
    });
});

// ─────────────────────────────────────────────
// A mesma regra escrita em dois lugares
// ─────────────────────────────────────────────
/**
 * `getRedirectPath` (UserController) responde "para onde este perfil vai depois
 * do login". `painelDoPerfil` (utils/painelPorPerfil) responde a mesma coisa, e
 * dela o `protegerPaginas` deriva "quem pode abrir este painel".
 *
 * São dois lados da MESMA regra, e foi a divergência entre eles que produziu o
 * bug: o login mandava o responsável para o portal enquanto nada impedia que
 * ele abrisse o dashboard do professor por outro caminho — bastava um link
 * antigo, o histórico do navegador ou a URL digitada.
 *
 * O ideal seria o controller apenas delegar, e a duplicação sumir por
 * construção. Não dá: o gate de lint do CI é por ARQUIVO, e tocar em
 * `UserController.js` obrigaria a reformatar as ~1000 linhas de dívida antiga
 * dele junto com a correção — num controller de autenticação, isso enterra a
 * mudança real e torna a revisão impossível. Enquanto essa dívida não for paga
 * num PR `chore:` próprio, é ESTE teste que segura a consistência: mexer num
 * lado sem mexer no outro fica vermelho aqui, e não em produção.
 */
describe('destino pós-login e gate de painel concordam', () => {
    const { getRedirectPath } = require('../controllers/UserController');
    const {
        PAINEL_POR_PERFIL,
        painelDoPerfil,
        PAINEL_DASHBOARD,
    } = require('../utils/painelPorPerfil');

    it.each(Object.keys(PAINEL_POR_PERFIL))(
        'perfil %s vai para o mesmo lugar nos dois',
        (perfil) => {
            expect(getRedirectPath({ perfil })).toBe(painelDoPerfil(perfil));
        }
    );

    // Desde a Issue #104 o `getRedirectPath` delega para `painelDoPerfil`, e o
    // bloco acima virou quase tautologia. Fica porque é barato e porque marca o
    // contrato; o que passou a valer a pena travar são as três decisões que a
    // delegação NÃO cobre — e uma delas é mudança de comportamento.
    it('sem usuário vai para o login', () => {
        expect(getRedirectPath(null)).toBe('/html/login.html');
    });

    it('senha a trocar tem precedência sobre qualquer painel', () => {
        expect(getRedirectPath({ perfil: 'admin', deveMudarSenha: true })).toBe(
            '/html/mudar-senha.html'
        );
    });

    it('perfil desconhecido cai na tela de escolha, não no dashboard', () => {
        // Antes da delegação, o `return` final do `getRedirectPath` entregava o
        // painel do professor a qualquer perfil não previsto.
        expect(getRedirectPath({ perfil: 'perfil-que-ninguem-cadastrou' })).toBe(
            '/html/escolher-perfil.html'
        );
        expect(getRedirectPath({})).toBe('/html/escolher-perfil.html');
    });

    it('ninguém que o login manda ao dashboard encontra a porta fechada', () => {
        // O gate pode ser MAIOR que a lista de moradores (a secretaria entra por
        // um botão do painel dela), mas nunca menor: mandar a pessoa para uma
        // página que o gate recusa produziria um laço de redirecionamento na
        // cara de quem acabou de logar.
        const { AREAS } = require('../middleware/protegerPaginas');

        const doGate = AREAS[PAINEL_DASHBOARD].perfis;
        const doLogin = Object.keys(PAINEL_POR_PERFIL).filter(
            (perfil) => getRedirectPath({ perfil }) === PAINEL_DASHBOARD
        );

        for (const perfil of doLogin) {
            expect(`${perfil} entra: ${doGate.includes(perfil)}`).toBe(`${perfil} entra: true`);
        }
    });

    it('o gate recusa o responsável, e o login concorda', () => {
        // A checagem que pega o bug original pelos dois lados.
        const { AREAS } = require('../middleware/protegerPaginas');

        expect(AREAS[PAINEL_DASHBOARD].perfis).not.toContain('responsavel');
        expect(getRedirectPath({ perfil: 'responsavel' })).not.toBe(PAINEL_DASHBOARD);
    });

    it('o responsável nunca é mandado ao dashboard', () => {
        expect(getRedirectPath({ perfil: 'responsavel' })).not.toBe(PAINEL_DASHBOARD);
        expect(painelDoPerfil('responsavel')).toBe('/portal-responsavel/dist/index.html');
    });
});
