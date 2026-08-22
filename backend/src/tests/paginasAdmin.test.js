/**
 * paginasAdmin.test.js
 * Suite — controle de acesso às PÁGINAS de /html/admin
 *
 * Esta falha é silenciosa por natureza: com o gate removido a aplicação
 * continua funcionando perfeitamente para os usuários legítimos, e o vazamento
 * (qualquer visitante baixando o HTML/JS administrativo) só aparece em pentest
 * ou quando alguém repara na URL. A checagem que existia vivia DENTRO da
 * página, isto é, rodava depois de o arquivo já estar no navegador — aparência,
 * não autorização.
 */
const request = require('supertest');

const app = require('../app');
const {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    criarUsuario,
    SENHA_TESTE,
} = require('./helpers');

const PAGINAS_SO_ADMIN = [
    '/html/admin/auditoria.html',
    '/html/admin/configuracoes.html',
    '/html/admin/codigos-escolas.html',
    // Estas duas não tinham NENHUMA verificação, nem a de fachada.
    '/html/admin/diagnostico.html',
    // Exibe códigos de backup 2FA recém-gerados: se vazasse, entregaria a um
    // anônimo o segundo fator de diretor e secretaria.
    '/html/admin/codigos-backup.html',
];

const { assinarTokenSessao } = require('../utils/sessionToken');

/**
 * Cria o usuário e devolve o cookie de sessão dele.
 *
 * Assina o token direto em vez de passar pelo POST /login porque diretor e
 * secretaria têm 2FA obrigatório — o login deles NÃO emite `escola_jwt`, só o
 * pré-auth de 5 minutos. O que esta suite verifica é o gate de página diante de
 * uma sessão legítima já estabelecida; o fluxo de login tem suite própria
 * (auth.test.js). Um teste abaixo usa o login real para provar que o cookie
 * emitido pelo controller também é aceito aqui.
 */
async function sessaoDe(perfil, email) {
    const usuario = await criarUsuario({ email, perfil, nome: `Teste ${perfil}` });
    return [`escola_jwt=${assinarTokenSessao(usuario)}`];
}

async function loginComo(perfil, email) {
    await criarUsuario({ email, perfil, nome: `Teste ${perfil}` });
    const res = await request(app).post('/api/auth/login').send({ email, senha: SENHA_TESTE });
    return (res.headers['set-cookie'] || []).filter((c) => c.startsWith('escola_jwt'));
}

beforeAll(async () => {
    await conectarBanco();
});
afterEach(async () => {
    await limparBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

describe('Páginas administrativas: visitante sem sessão', () => {
    it.each(PAGINAS_SO_ADMIN)('nao entrega %s — redireciona para o login', async (pagina) => {
        const res = await request(app).get(pagina);

        expect(res.status).toBe(302);
        expect(res.headers.location).toMatch(/\/html\/login\.html/);
    });

    it('nao vaza o conteudo da pagina no corpo do redirect', async () => {
        const res = await request(app).get('/html/admin/usuarios.html');

        // O marcador do formulário de criação de usuário não pode aparecer.
        expect(res.text).not.toMatch(/Administrador<\/option>/);
        expect(res.text).not.toMatch(/<table/i);
    });

    it('cookie forjado nao passa — assinatura invalida cai no login', async () => {
        const res = await request(app)
            .get('/html/admin/auditoria.html')
            .set('Cookie', ['escola_jwt=nao.e.um.token.valido']);

        expect(res.status).toBe(302);
        expect(res.headers.location).toMatch(/\/html\/login\.html/);
    });
});

describe('Páginas administrativas: sessão sem privilégio', () => {
    it.each(PAGINAS_SO_ADMIN)('professor autenticado recebe 404 em %s', async (pagina) => {
        const cookies = await loginComo('professor', 'prof_gate@escola.test');
        expect(cookies.length).toBeGreaterThan(0); // o login precisa ter funcionado

        const res = await request(app).get(pagina).set('Cookie', cookies);

        // 404 e não 403: um 403 confirmaria que a página existe.
        expect(res.status).toBe(404);
        expect(res.text).not.toMatch(/Auditoria|Configurações do Sistema/i);
    });

    it('responsavel autenticado nao acessa a gestao de usuarios', async () => {
        const cookies = await loginComo('responsavel', 'resp_gate@escola.test');

        const res = await request(app).get('/html/admin/usuarios.html').set('Cookie', cookies);

        expect(res.status).toBe(404);
    });
});

describe('Páginas administrativas: quem deve entrar, entra', () => {
    it('admin recebe a pagina de usuarios', async () => {
        const cookies = await loginComo('admin', 'admin_gate@escola.test');

        const res = await request(app).get('/html/admin/usuarios.html').set('Cookie', cookies);

        expect(res.status).toBe(200);
        expect(res.text).toMatch(/Administrador<\/option>/);
    });

    it('admin recebe a pagina de auditoria', async () => {
        const cookies = await loginComo('admin', 'admin_aud@escola.test');

        const res = await request(app).get('/html/admin/auditoria.html').set('Cookie', cookies);

        expect(res.status).toBe(200);
    });

    it('diretor entra em usuarios.html (perfil previsto para a pagina)', async () => {
        const cookies = await sessaoDe('diretor', 'dir_gate@escola.test');

        const res = await request(app).get('/html/admin/usuarios.html').set('Cookie', cookies);

        expect(res.status).toBe(200);
    });

    it('diretor NAO entra na auditoria (pagina restrita a admin)', async () => {
        const cookies = await sessaoDe('diretor', 'dir_aud@escola.test');

        const res = await request(app).get('/html/admin/auditoria.html').set('Cookie', cookies);

        expect(res.status).toBe(404);
    });

    it('o cookie emitido pelo login real do controller e aceito pelo gate', async () => {
        const cookies = await loginComo('admin', 'admin_login_real@escola.test');
        expect(cookies.length).toBeGreaterThan(0);

        const res = await request(app).get('/html/admin/configuracoes.html').set('Cookie', cookies);

        expect(res.status).toBe(200);
    });
});

describe('Páginas administrativas: regressões do gate', () => {
    it('conta desativada apos o login perde a pagina na requisicao seguinte', async () => {
        const cookies = await loginComo('admin', 'admin_off@escola.test');
        const Usuario = require('../models/Usuario');
        await Usuario.updateOne({ email: 'admin_off@escola.test' }, { $set: { ativo: false } });

        const res = await request(app).get('/html/admin/auditoria.html').set('Cookie', cookies);

        expect(res.status).toBe(302);
    });

    it('rebaixamento de perfil vale imediatamente — o perfil vem do banco', async () => {
        const cookies = await loginComo('admin', 'admin_down@escola.test');
        const Usuario = require('../models/Usuario');
        await Usuario.updateOne(
            { email: 'admin_down@escola.test' },
            { $set: { perfil: 'professor' } }
        );

        const res = await request(app).get('/html/admin/auditoria.html').set('Cookie', cookies);

        expect(res.status).toBe(404);
    });

    it('paginas fora de /html/admin seguem publicas (o gate nao vazou escopo)', async () => {
        const res = await request(app).get('/html/login.html');

        expect(res.status).toBe(200);
    });
});

describe('Área da secretaria', () => {
    const PAGINA = '/html/secretaria/painel.html';

    it('visitante anonimo nao recebe o painel', async () => {
        const res = await request(app).get(PAGINA);
        expect(res.status).toBe(302);
    });

    it('professor autenticado recebe 404', async () => {
        const cookies = await sessaoDe('professor', 'prof_sec@escola.test');
        const res = await request(app).get(PAGINA).set('Cookie', cookies);
        expect(res.status).toBe(404);
    });

    it.each(['secretaria', 'diretor', 'admin'])('%s entra no painel', async (perfil) => {
        const cookies = await sessaoDe(perfil, `${perfil}_sec@escola.test`);
        const res = await request(app).get(PAGINA).set('Cookie', cookies);
        // Espelha authorize('secretaria','diretor','admin') de routes/secretaria.js
        expect(res.status).toBe(200);
    });
});

describe('Área da direção', () => {
    it('visitante anonimo nao recebe o painel da direcao', async () => {
        const res = await request(app).get('/html/direcao/index.html');
        expect(res.status).toBe(302);
    });

    it('secretaria NAO entra no painel da direcao', async () => {
        const cookies = await sessaoDe('secretaria', 'sec_dir@escola.test');
        const res = await request(app).get('/html/direcao/index.html').set('Cookie', cookies);
        expect(res.status).toBe(404);
    });

    it('diretor entra no painel da direcao', async () => {
        const cookies = await sessaoDe('diretor', 'dir_painel@escola.test');
        const res = await request(app).get('/html/direcao/index.html').set('Cookie', cookies);
        expect(res.status).toBe(200);
    });

    // Este caso já afirmou o oposto ("admin-only, mesmo para diretor"), com a
    // justificativa de que a API por trás seria `routes/escolas.js`. Era engano:
    // aquele endpoint serve o código de cadastro de DOCENTE e a página nunca o
    // chama. Ela consome `/api/alunos/codigos-secretos`, que é
    // `authorize('admin', 'diretor', 'secretaria')` — ou seja, o diretor já
    // obtinha o dado pela API enquanto a tela lhe dava 404. Ver Issue #56.
    it('diretor abre a tela de codigos secretos dos alunos', async () => {
        const cookies = await sessaoDe('diretor', 'dir_cod@escola.test');
        const res = await request(app).get('/direcao/codigos-secretos.html').set('Cookie', cookies);
        expect(res.status).toBe(200);
    });

    it('admin continua abrindo a tela de codigos secretos', async () => {
        const cookies = await sessaoDe('admin', 'adm_cod@escola.test');
        const res = await request(app).get('/direcao/codigos-secretos.html').set('Cookie', cookies);
        expect(res.status).toBe(200);
    });

    // O JS da página carrega tanta informação quanto o HTML — o gate precisa
    // tratar os dois igual, senão a tela abre e morre no primeiro fetch.
    it('diretor tambem carrega o JS da tela de codigos secretos', async () => {
        const cookies = await sessaoDe('diretor', 'dir_cod_js@escola.test');
        const res = await request(app).get('/direcao/codigos-secretos.js').set('Cookie', cookies);
        expect(res.status).toBe(200);
    });

    // O código é o que o RESPONSÁVEL usa para se vincular ao aluno — entregar
    // isso é trabalho de secretaria, e a API já a autoriza.
    it('secretaria abre a tela de codigos secretos', async () => {
        const cookies = await sessaoDe('secretaria', 'sec_cod@escola.test');
        const res = await request(app).get('/direcao/codigos-secretos.html').set('Cookie', cookies);
        expect(res.status).toBe(200);
    });

    // A exceção é POR ARQUIVO: libera a tela de códigos, não a área /direcao.
    it('secretaria continua fora do resto da area da direcao', async () => {
        const cookies = await sessaoDe('secretaria', 'sec_dir_resto@escola.test');
        const res = await request(app).get('/direcao/gen_html.py').set('Cookie', cookies);
        expect(res.status).toBe(404);
    });

    it('anonimo continua sem a tela de codigos secretos', async () => {
        const res = await request(app).get('/direcao/codigos-secretos.html');
        expect(res.status).toBe(302);
    });
});

describe('Assets das áreas restritas', () => {
    // O gate cobre TODOS os arquivos, não só .html: um .js de página
    // administrativa carrega tanta informação quanto o HTML.
    it('script Python de processamento de planilha nao e publico', async () => {
        const res = await request(app).get('/direcao/gen_html.py');
        expect(res.status).toBe(302);
        expect(res.text).not.toMatch(/import |def /);
    });

    it('JS interno da direcao nao e publico', async () => {
        const res = await request(app).get('/direcao/direcao.js');
        expect(res.status).toBe(302);
    });

    it('mas o diretor autenticado recebe o JS da propria area', async () => {
        const cookies = await sessaoDe('diretor', 'dir_asset@escola.test');
        const res = await request(app).get('/direcao/direcao.js').set('Cookie', cookies);
        expect(res.status).toBe(200);
    });

    it('assets globais (/js, /css) continuam publicos', async () => {
        const res = await request(app).get('/js/auth.js');
        expect(res.status).toBe(200);
    });
});

/**
 * Tela de conversas (Issue #72).
 *
 * Ela é a única entrada do gate que aponta para um ARQUIVO e não para um
 * diretório: conversar não pertence a nenhuma área, e a tela vive solta em
 * /html justamente para alcançar professor, secretaria e responsável.
 *
 * O gate aqui não protege conteúdo — a página é só o shell, e quem guarda a
 * mensagem é a API. Ele existe para o anônimo cair no login em vez de encarar
 * uma interface que nunca vai carregar.
 */
describe('Tela de conversas', () => {
    it('visitante anonimo vai para o login', async () => {
        const res = await request(app).get('/html/conversas.html');
        expect(res.status).toBe(302);
        expect(res.headers.location).toMatch(/login/);
    });

    // A lista espelha MATRIZ_CONVERSA: são os perfis que têm com quem falar.
    it.each(['admin', 'diretor', 'secretaria', 'professor', 'responsavel'])(
        '%s abre a tela de conversas',
        async (perfil) => {
            const cookies = await sessaoDe(perfil, `${perfil}_conv_gate@escola.test`);
            const res = await request(app).get('/html/conversas.html').set('Cookie', cookies);
            expect(res.status).toBe(200);
        }
    );

    // Não há caso de perfil recusado porque não existe perfil fora da lista:
    // o enum de `Usuario` tem exatamente estes cinco. O caso abaixo é o que
    // guarda isso — se alguém acrescentar um perfil ao model sem decidir
    // conscientemente sobre o chat, este teste quebra e força a decisão.
    it('a lista do gate cobre todos os perfis do model', () => {
        const Usuario = require('../models/Usuario');
        const doModel = Usuario.schema.path('perfil').enumValues.slice().sort();
        const { AREAS } = require('../middleware/protegerPaginas');
        const doGate = AREAS['/html/conversas.html'].perfis.slice().sort();
        expect(doGate).toEqual(doModel);
    });

    // A chave é de arquivo: não pode virar prefixo e engolir vizinhos.
    it('o gate do arquivo nao alcanca outras paginas de /html', async () => {
        const res = await request(app).get('/html/login.html');
        expect(res.status).toBe(200);
    });
});
