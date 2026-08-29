/**
 * @jest-environment jsdom
 */

/**
 * matrizAcesso.test.js — a trava de acesso por perfil (Issue #119).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O QUE ESTA SUÍTE PROTEGE
 * ─────────────────────────────────────────────────────────────────────────
 * A regra "qual perfil abre qual página" agora está escrita uma vez
 * (`utils/matrizAcesso.js`) e LIDA em dois lugares: o gate do servidor e o
 * guard do navegador (`js/guarda-acesso.js`), que carrega uma cópia embutida
 * para poder decidir antes do primeiro pixel.
 *
 * Cópia embutida é dívida assumida: ela existe porque buscar a matriz pela rede
 * custaria um RTT com a tela escondida. O que impede a dívida de virar defeito é
 * este arquivo — ele carrega o guard DE VERDADE em jsdom, pergunta a mesma coisa
 * aos dois lados e falha quando as respostas divergem. Mexer num lado só fica
 * vermelho aqui, no CI, e não em produção como uma tela que abre para quem não
 * devia.
 *
 * As três perguntas, na ordem em que a Issue as coloca:
 *   1. servidor e navegador dão o mesmo veredito?
 *   2. a exceção por arquivo vence a área que a contém?
 *   3. o prefixo secreto da área administrativa vaza para o navegador?
 */

const fs = require('node:fs');
const path = require('node:path');

const matriz = require('../utils/matrizAcesso');
const { PAINEL_POR_PERFIL } = require('../utils/painelPorPerfil');

const RAIZ = path.resolve(__dirname, '../../..');
const ARQUIVO_GUARD = path.join(RAIZ, 'js', 'guarda-acesso.js');

/** Todos os perfis do enum, mais o anônimo. */
const PERFIS = [...Object.keys(PAINEL_POR_PERFIL), null];

/**
 * Carrega `js/guarda-acesso.js` como o navegador carregaria, e devolve a API
 * que ele publica em `window.GuardaAcesso`.
 *
 * O arquivo é executado de verdade — nada de reimplementar a lógica dele aqui,
 * que é o erro clássico que faz um teste de paridade passar enquanto os dois
 * lados divergem.
 */
function carregarGuard(pathname = '/html/login.html') {
    delete window.GuardaAcesso;

    // O guard lê `location.pathname` na execução e dispara `fetch` quando a
    // página exige sessão. Aqui só interessa a tabela de decisão, então o fetch
    // fica pendente de propósito — nenhuma das asserções depende dele.
    window.fetch = jest.fn(() => new Promise(() => {}));
    delete window.location;
    window.location = { pathname, hostname: 'localhost', protocol: 'http:', replace: jest.fn() };

    const fonte = fs.readFileSync(ARQUIVO_GUARD, 'utf8');
    // eslint-disable-next-line no-new-func
    new Function(fonte).call(window);

    return window.GuardaAcesso;
}

/** Veredito do navegador reduzido à pergunta "pode abrir?". */
function podeNoNavegador(guard, perfil, caminho) {
    return guard.permitido(guard.vereditoDe(caminho), perfil);
}

/**
 * Caminhos exercitados pela paridade. Cobre uma página de cada área, os dois
 * lados de cada exceção, as públicas e o desconhecido.
 */
const CAMINHOS = [
    '/',
    '/index.html',
    '/html/login.html',
    '/html/politica-privacidade.html',
    '/html/dashboard.html',
    '/html/conversas.html',
    '/html/secretaria/painel.html',
    '/html/secretaria/matriculas.html',
    '/html/direcao/moderacao.html',
    '/html/direcao/bi-pedagogico.html',
    '/direcao/auditoria.html',
    '/direcao/codigos-secretos.html',
    '/direcao/codigos-secretos.js',
    '/direcao/horario-jaguari.html',
    '/html/pagina-que-nao-existe.html',
    '/detalhes/alunos.html',
];

describe('matriz de acesso — paridade entre servidor e navegador', () => {
    let guard;

    beforeEach(() => {
        guard = carregarGuard();
    });

    it('publica uma matriz que o guard consegue carregar', () => {
        expect(guard).toBeDefined();
        expect(typeof guard.vereditoDe).toBe('function');
        expect(guard.matriz().areas).toBeDefined();
    });

    it.each(CAMINHOS)('dá o mesmo veredito para %s', (caminho) => {
        for (const perfil of PERFIS) {
            expect({ caminho, perfil, pode: podeNoNavegador(guard, perfil, caminho) }).toEqual({
                caminho,
                perfil,
                pode: matriz.podeAbrir(perfil, caminho),
            });
        }
    });

    it('normaliza caminhos do mesmo jeito nos dois lados', () => {
        const bagunçados = [
            '/HTML/Dashboard.html',
            '/html//dashboard.html',
            '/html\\dashboard.html',
            '/html/secretaria/',
            '/html/secretaria',
        ];
        for (const bruto of bagunçados) {
            expect(guard.normalizarCaminho(bruto)).toBe(matriz.normalizarCaminho(bruto));
        }
    });

    it('manda cada perfil para o mesmo painel nos dois lados', () => {
        const { painelDoPerfil } = require('../utils/painelPorPerfil');
        for (const perfil of Object.keys(PAINEL_POR_PERFIL)) {
            expect(guard.painelDoPerfil(perfil)).toBe(painelDoPerfil(perfil));
        }
        // Perfil fora do enum cai na mesma tela de escolha nos dois.
        expect(guard.painelDoPerfil('inventado')).toBe(painelDoPerfil('inventado'));
    });

    it('espelha regra por regra o que o backend declara como publicável', () => {
        expect(guard.matriz()).toEqual(matriz.matrizPublicavel());
    });
});

describe('matriz de acesso — precedência da exceção por arquivo', () => {
    it('a exceção AMPLIA o acesso da área que a contém', () => {
        // /direcao é admin+diretor; a exceção acrescenta a secretaria.
        expect(matriz.podeAbrir('secretaria', '/direcao/auditoria.html')).toBe(false);
        expect(matriz.podeAbrir('secretaria', '/direcao/codigos-secretos.html')).toBe(true);
        expect(matriz.podeAbrir('secretaria', '/direcao/codigos-secretos.js')).toBe(true);
    });

    it('a exceção vale só para o arquivo nomeado, não para o diretório', () => {
        expect(matriz.perfisPermitidos('/direcao/codigos-secretos.html')).toContain('secretaria');
        expect(matriz.perfisPermitidos('/direcao/outra-pagina.html')).not.toContain('secretaria');
    });

    it('a exceção da área administrativa deixa o diretor entrar onde a área é admin-only', () => {
        expect(matriz.podeAbrir('diretor', '/html/admin/usuarios.html')).toBe(true);
        expect(matriz.podeAbrir('diretor', '/html/admin/cadastro-secretaria.html')).toBe(true);
        expect(matriz.podeAbrir('diretor', '/html/admin/configuracoes.html')).toBe(false);
    });

    it('casa por segmento completo — /html/administrativo não é /html/admin', () => {
        expect(matriz.regraDe('/html/administrativo/x.html')).toBeNull();
        expect(matriz.regraDe('/html/admin/x.html').prefixo).toBe('/html/admin');
    });

    it('página nova dentro de uma área nasce protegida pelo padrão da área', () => {
        expect(matriz.perfisPermitidos('/html/secretaria/pagina-nova.html')).toEqual(
            matriz.AREAS['/html/secretaria'].perfis
        );
    });

    it('página fora de qualquer área e fora das públicas exige sessão, sem exigir perfil', () => {
        const veredito = matriz.vereditoDe('/html/pagina-nova-solta.html');
        expect(veredito.publica).toBe(false);
        expect(veredito.exigeSessao).toBe(true);
        expect(veredito.perfis).toBeNull();
        expect(matriz.podeAbrir(null, '/html/pagina-nova-solta.html')).toBe(false);
        expect(matriz.podeAbrir('responsavel', '/html/pagina-nova-solta.html')).toBe(true);
    });

    it('o responsável continua barrado no dashboard, que foi o defeito de origem', () => {
        expect(matriz.podeAbrir('responsavel', '/html/dashboard.html')).toBe(false);
        expect(matriz.vereditoDe('/html/dashboard.html').redirecionarAoPainel).toBe(true);
    });
});

describe('matriz de acesso — o prefixo secreto não vaza', () => {
    const SEGREDO = 'f3a91c7d5e';

    it('a área administrativa não aparece na projeção publicável', () => {
        const publicavel = matriz.matrizPublicavel();
        expect(Object.keys(publicavel.areas)).not.toContain('/html/admin');
        expect(JSON.stringify(publicavel)).not.toMatch(/admin\//);
    });

    it('o valor de ADMIN_PATH não aparece na matriz publicável, com ele configurado', () => {
        const anterior = process.env.ADMIN_PATH;
        process.env.ADMIN_PATH = SEGREDO;
        try {
            jest.resetModules();
            const recarregada = require('../utils/matrizAcesso');
            expect(JSON.stringify(recarregada.matrizPublicavel())).not.toContain(SEGREDO);
        } finally {
            if (anterior === undefined) delete process.env.ADMIN_PATH;
            else process.env.ADMIN_PATH = anterior;
            jest.resetModules();
        }
    });

    it('o guard servido ao navegador não contém o caminho da área administrativa', () => {
        const fonte = fs.readFileSync(ARQUIVO_GUARD, 'utf8');
        // O nome aparece em comentário explicando por que a área ficou de fora;
        // o que não pode existir é uma REGRA para ela na matriz embutida.
        const guard = carregarGuard();
        expect(Object.keys(guard.matriz().areas)).not.toContain('/html/admin');
        expect(fonte).not.toContain('ADMIN_PATH=');
    });

    it('a matriz não lê ADMIN_PATH em lugar nenhum', () => {
        const fonte = fs.readFileSync(
            path.join(__dirname, '..', 'utils', 'matrizAcesso.js'),
            'utf8'
        );
        expect(fonte).not.toContain('process.env.ADMIN_PATH');
    });

    it('sob o apelido, a página de login da área não é mandada para o login geral', () => {
        // `/html/<segredo>/entrar.html` não casa com área nenhuma no navegador.
        // Sem a isenção por nome de arquivo, o guard mandaria para /html/login.html
        // justamente a tela que existe para fazer login.
        const guard = carregarGuard(`/html/${SEGREDO}/entrar.html`);
        const veredito = guard.vereditoDe(`/html/${SEGREDO}/entrar.html`);
        expect(veredito.exigeSessao).toBe(false);
        expect(guard.permitido(veredito, null)).toBe(true);
        expect(matriz.podeAbrir(null, `/html/${SEGREDO}/entrar.html`)).toBe(true);
    });
});

describe('matriz de acesso — o gate do servidor consome a mesma tabela', () => {
    // Lido como TEXTO, e não com `require`. O gate importa `models/Usuario`, que
    // arrasta o mongoose — e o mongoose não carrega sob `@jest-environment jsdom`
    // (o bundle ESM do `bson` estoura no transform). Trocar o ambiente desta
    // suíte não é opção: ela precisa de jsdom para executar o guard de verdade,
    // que é a razão de ela existir.
    //
    // A perda é pequena e a asserção continua sendo a mesma: o que importa é o
    // gate NÃO ter tabela própria. Uma cópia reintroduzida apareceria como uma
    // declaração literal de `AREAS` no arquivo, e é isso que se cobra aqui.
    it('protegerPaginas consome a matriz e não mantém cópia própria', () => {
        const fonte = fs.readFileSync(
            path.join(__dirname, '..', 'middleware', 'protegerPaginas.js'),
            'utf8'
        );
        expect(fonte).toMatch(/require\(['"]\.\.\/utils\/matrizAcesso['"]\)/);
        expect(fonte).not.toMatch(/const\s+AREAS\s*=\s*\{/);
        expect(fonte).not.toMatch(/const\s+PAGINAS_SEM_SESSAO\s*=/);
    });

    it('as páginas com guard injetado são exatamente as não públicas', () => {
        const publicas = new Set(matriz.PAGINAS_PUBLICAS);
        const semGuard = [];
        const comGuardIndevido = [];

        const varrer = (dir) => {
            for (const nome of fs.readdirSync(dir)) {
                if (
                    ['node_modules', '.git', 'portal-responsavel', 'dist', '.claude'].includes(nome)
                )
                    continue;
                const completo = path.join(dir, nome);
                const info = fs.statSync(completo);
                if (info.isDirectory()) {
                    varrer(completo);
                    continue;
                }
                if (!nome.endsWith('.html')) continue;

                const url = `/${path.relative(RAIZ, completo).split(path.sep).join('/')}`;
                const temGuard = fs.readFileSync(completo, 'utf8').includes('guarda-acesso.js');

                if (publicas.has(url) && temGuard) comGuardIndevido.push(url);
                if (!publicas.has(url) && !temGuard) semGuard.push(url);
            }
        };
        varrer(RAIZ);

        expect(semGuard).toEqual([]);
        expect(comGuardIndevido).toEqual([]);
    });

    it('o guard entra sem defer — a decisão precisa vir antes do primeiro pixel', () => {
        const pagina = fs.readFileSync(path.join(RAIZ, 'html', 'dashboard.html'), 'utf8');
        const tag = pagina.match(/<script[^>]*guarda-acesso\.js[^>]*>/);
        expect(tag).not.toBeNull();
        expect(tag[0]).not.toMatch(/\bdefer\b/);
        expect(tag[0]).not.toMatch(/\basync\b/);

        // E antes de qualquer outro script da página.
        const posGuard = pagina.indexOf('guarda-acesso.js');
        const primeiroScript = pagina.indexOf('<script');
        expect(pagina.slice(primeiroScript, posGuard)).not.toMatch(/<\/script>/);
    });

    it('o service worker guarda o guard na shell mínima', () => {
        const sw = fs.readFileSync(path.join(RAIZ, 'service-worker.js'), 'utf8');
        expect(sw).toContain("'/js/guarda-acesso.js'");
    });
});

/**
 * ─────────────────────────────────────────────────────────────────────────
 * COMPORTAMENTO, E NÃO SÓ A TABELA
 * ─────────────────────────────────────────────────────────────────────────
 * Os blocos acima comparam vereditos — os dois lados respondem a mesma coisa.
 * Isso não prova que o guard AGE conforme o veredito, e o defeito da Issue era
 * justamente de ação: a tela aparecia antes de a decisão sair.
 *
 * Aqui o guard é executado de verdade, com `sessionStorage` e `fetch` no lugar,
 * e o que se observa é o que o usuário observaria: o documento ficou escondido?
 * chegou a aparecer antes do redirecionamento? para onde a pessoa foi parar?
 */
describe('guarda-acesso — o que o usuário vê', () => {
    const proximoTick = () => new Promise((resolve) => setTimeout(resolve, 0));

    /** Executa o guard numa página, com (ou sem) um usuário em cache. */
    function abrirPagina(pathname, usuario) {
        document.documentElement.removeAttribute('data-guarda-acesso');
        document.head.innerHTML = '';
        sessionStorage.clear();
        if (usuario) sessionStorage.setItem('currentUser', JSON.stringify(usuario));

        const replace = jest.fn();
        delete window.location;
        window.location = { pathname, hostname: 'localhost', protocol: 'http:', replace };

        // O servidor confirma exatamente o que está em cache. Divergência entre
        // os dois é outro cenário, e não é o que estes casos observam.
        window.fetch = jest.fn(() =>
            Promise.resolve({
                ok: Boolean(usuario),
                json: () => Promise.resolve({ success: Boolean(usuario), user: usuario }),
            })
        );

        const fonte = fs.readFileSync(ARQUIVO_GUARD, 'utf8');
        // biome-ignore lint/security/noGlobalEval: é assim que o navegador carrega o arquivo.
        new Function(fonte).call(window);

        return {
            replace,
            estado: () => document.documentElement.getAttribute('data-guarda-acesso'),
        };
    }

    it('não esconde página pública — seria custo em toda visita anônima', () => {
        expect(abrirPagina('/html/login.html', null).estado()).toBeNull();
    });

    it('esconde a página restrita ANTES de qualquer resposta', () => {
        expect(abrirPagina('/html/dashboard.html', null).estado()).toBe('verificando');
    });

    it('revela na hora quando o cache já autoriza — o caminho comum', () => {
        expect(abrirPagina('/html/dashboard.html', { perfil: 'professor' }).estado()).toBe(
            'liberado'
        );
    });

    it('manda o responsável ao portal SEM nunca revelar o dashboard', async () => {
        const pagina = abrirPagina('/html/dashboard.html', { perfil: 'responsavel' });
        expect(pagina.estado()).toBe('verificando');

        await proximoTick();
        await proximoTick();
        await proximoTick();

        expect(pagina.replace).toHaveBeenCalledWith('/portal-responsavel/dist/index.html');
        // O ponto da Issue: a tela errada não chega a piscar.
        expect(pagina.estado()).toBe('verificando');
    });

    it('manda o anônimo de uma página restrita para o login', async () => {
        const pagina = abrirPagina('/html/secretaria/painel.html', null);
        await proximoTick();
        await proximoTick();
        await proximoTick();
        expect(pagina.replace).toHaveBeenCalledWith('/html/login.html');
    });

    it('aplica a exceção por arquivo na prática, não só na tabela', async () => {
        expect(
            abrirPagina('/direcao/codigos-secretos.html', { perfil: 'secretaria' }).estado()
        ).toBe('liberado');

        const negada = abrirPagina('/direcao/auditoria.html', { perfil: 'secretaria' });
        await proximoTick();
        await proximoTick();
        await proximoTick();
        expect(negada.replace).toHaveBeenCalledWith('/html/secretaria/painel.html');
    });

    it('sob o apelido, a área administrativa exige sessão e aceita quem a tem', () => {
        // O servidor já conferiu o perfil antes de entregar a página; o guard só
        // não deixa a versão cacheada aparecer para quem não tem sessão nenhuma.
        expect(abrirPagina('/html/f3a91c7d5e/usuarios.html', { perfil: 'diretor' }).estado()).toBe(
            'liberado'
        );
    });

    it('não esconde a tela de login da área administrativa', () => {
        expect(abrirPagina('/html/f3a91c7d5e/entrar.html', null).estado()).toBeNull();
    });
});
