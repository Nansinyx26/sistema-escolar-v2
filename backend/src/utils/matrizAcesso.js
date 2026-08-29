/**
 * matrizAcesso.js
 * ============================================================================
 * QUAL PERFIL ALCANÇA QUAL PÁGINA — a tabela, e só a tabela.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE ARQUIVO EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 * A resposta estava espalhada por três lugares que não conversavam:
 *
 *   • `middleware/protegerPaginas.js` — o mapa `AREAS`, que decide de verdade;
 *   • `utils/rotasFront.js`           — `PERFIS_POR_PAGINA`, que decide quais
 *                                       botões do painel administrativo saem
 *                                       na resposta de `/api/auth/rotas`;
 *   • cada página                     — `if (user.perfil !== 'admin')` escrito
 *                                       à mão, tela por tela.
 *
 * Os dois primeiros já se espelhavam por COMENTÁRIO ("ESPELHA AREAS['/html/admin']"),
 * que é a forma mais frágil possível de manter duas listas iguais: nada quebra
 * quando divergem, e o sintoma aparece só em produção, como um botão que abre e
 * toma 404 na cara do usuário. O terceiro é pior — roda depois de o HTML já
 * estar no navegador, então não é autorização, é aparência.
 *
 * Aqui a tabela passa a ser uma só. O middleware consome, `rotasFront` consome,
 * e o navegador recebe uma PROJEÇÃO dela (ver `matrizPublicavel`).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O QUE ESTE ARQUIVO NÃO É
 * ─────────────────────────────────────────────────────────────────────────
 * Não é o gate. O gate continua sendo `middleware/protegerPaginas.js`, que é
 * quem normaliza o caminho, resolve o apelido secreto, lê a sessão e responde
 * 404. Este arquivo não conhece `req`, não lê cookie e não sabe o que é uma
 * sessão — ele responde a UMA pergunta, com string de entrada e string de
 * saída, e é justamente por isso que dá para testá-lo contra o espelho do
 * navegador sem subir servidor nenhum.
 *
 * Também não é uma lista de páginas. Página nova dentro de uma área restrita
 * nasce protegida pelo padrão da área, sem depender de ninguém cadastrá-la.
 * ============================================================================
 */

const { PAINEL_POR_PERFIL, PAINEL_SEM_PERFIL, PERFIS_DO_DASHBOARD } = require('./painelPorPerfil');

/**
 * Páginas alcançáveis SEM sessão dentro de uma área restrita.
 *
 * Só a tela de login entra aqui, e por impasse: exigir sessão para chegar à
 * página que cria a sessão tornaria a área inacessível. O que a protege é o
 * prefixo secreto (ADMIN_PATH) — com ele configurado, /html/admin/entrar.html
 * responde 404 como todo o resto do caminho previsível.
 *
 * A isenção vale APENAS para a checagem de perfil. Tudo mais continua: o
 * caminho é normalizado antes, o apelido é resolvido antes, e a página não dá
 * acesso a nada — quem entra ainda precisa da senha.
 */
const PAGINAS_SEM_SESSAO = Object.freeze(['entrar.html']);

/**
 * Mapa das áreas restritas. O perfil mais restrito é sempre o padrão da área,
 * então uma página nova nasce protegida sem depender de alguém cadastrá-la.
 * As chaves DEVEM estar em minúsculas — a comparação é feita em caixa baixa.
 *
 * `excecoes` é por ARQUIVO e tem precedência sobre a área que o contém — nos
 * dois sentidos: ela tanto AMPLIA (`usuarios.html`, que o diretor abre dentro
 * de uma área admin-only) quanto poderia restringir. Precedência em vez de
 * interseção porque o caso real é sempre o de ampliar: a área declara o piso,
 * e a exceção descreve a página que foge dele, com o motivo escrito ao lado.
 */
const AREAS = {
    '/html/admin': {
        perfis: ['admin'],
        excecoes: {
            // Gestão de contas e cadastro de secretaria: o diretor cria equipe
            // da própria escola (UserController.create → isDiretorCreatingStaff).
            'usuarios.html': ['admin', 'diretor'],
            'cadastro-secretaria.html': ['admin', 'diretor'],
        },
        // A área inteira vive atrás do apelido secreto. Nada dela vai para o
        // navegador — ver `matrizPublicavel` e o bloco de comentário lá.
        segredoDeAmbiente: true,
    },
    // Espelha authorize('secretaria', 'diretor', 'admin') em routes/secretaria.js
    '/html/secretaria': { perfis: ['admin', 'diretor', 'secretaria'] },
    '/html/direcao': { perfis: ['admin', 'diretor'] },

    // ── Conversas ────────────────────────────────────────────────────────
    // Chave de ARQUIVO, não de diretório: `dentroDe()` casa por igualdade
    // exata, e a tela vive solta em /html porque conversar não pertence a
    // nenhuma área. Colocá-la dentro de /html/direcao a fecharia para
    // professor, secretaria e responsável — que são justamente quem mais
    // usa o chat.
    //
    // A lista espelha `MATRIZ_CONVERSA` do ChatDiretoController. Hoje ela
    // cobre TODOS os perfis existentes, então na prática este gate significa
    // "precisa estar autenticado". Enumerar mesmo assim, em vez de deixar a
    // tela pública, é o que garante que um perfil novo sem direito a chat não
    // ganhe a página de graça — teria de ser adicionado aqui de propósito.
    //
    // A proteção real do conteúdo continua na API — a página é só o shell.
    // O que este gate resolve é o anônimo cair no login em vez de encarar uma
    // interface que nunca vai carregar. Ver Issue #72.
    '/html/conversas.html': {
        perfis: ['admin', 'diretor', 'secretaria', 'professor', 'responsavel'],
    },

    // ── Painel unificado ─────────────────────────────────────────────────
    // O dashboard se adapta ao perfil que o abre (professor, diretor, admin) e
    // NUNCA conferiu qual era esse perfil. Um responsável que chegasse aqui —
    // pelo botão de voltar da tela de conversas, pelo histórico do navegador ou
    // digitando a URL — recebia a interface do professor, com a barra lateral
    // da escola e o rótulo de cargo trocado.
    //
    // A lista vem de `PERFIS_DO_DASHBOARD` e é DECLARADA, não derivada de quem
    // mora aqui. O motivo de cada nome está em utils/painelPorPerfil.js.
    //
    // `redirecionarAoPainel` troca o 404 padrão da área pelo painel de quem
    // pediu. Aqui o 404 seria a resposta errada: a página EXISTE, a pessoa está
    // autenticada e tem um painel próprio — negar sem levar a lugar nenhum
    // deixaria o responsável numa tela de erro em vez de no portal dele.
    '/html/dashboard.html': {
        perfis: PERFIS_DO_DASHBOARD,
        redirecionarAoPainel: true,
    },

    // `codigos-secretos.html` JÁ FOI admin-only aqui, por uma exceção baseada em
    // premissa errada: o comentário citava `routes/escolas.js → authorize('admin')`,
    // que é o código de cadastro de DOCENTE. A página é "Alunos — Códigos
    // Secretos" e consome `GET /api/alunos/codigos-secretos`, que é
    // `authorize('admin', 'diretor', 'secretaria')`.
    //
    // Isolamento multi-escola continua garantido no controller:
    // `StudentController.listSecretCodes` filtra por `req.escolaId`. Ver Issue #56.
    '/direcao': {
        perfis: ['admin', 'diretor'],
        excecoes: {
            // AMPLIA o acesso (como `usuarios.html` faz em /html/admin), não
            // restringe. A tela lista o código secreto que o RESPONSÁVEL usa
            // para se vincular ao aluno — trabalho corriqueiro de secretaria,
            // e `GET /api/alunos/codigos-secretos` já a autoriza.
            //
            // A secretaria só entra nestes dois arquivos; o resto de /direcao
            // continua fechado para ela pelos perfis acima.
            'codigos-secretos.html': ['admin', 'diretor', 'secretaria'],
            'codigos-secretos.js': ['admin', 'diretor', 'secretaria'],
        },
    },
};

/**
 * Páginas que qualquer pessoa abre, sem sessão nenhuma.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUE ESTA LISTA É EXPLÍCITA, E NÃO "TUDO QUE NÃO É ÁREA RESTRITA"
 * ─────────────────────────────────────────────────────────────────────────
 * No SERVIDOR, "não é área restrita" basta: o express.static entrega o arquivo
 * e pronto. No NAVEGADOR, não: o guard precisa distinguir "esta página é
 * pública" de "esta página não está na minha cópia da matriz porque a matriz
 * está velha, ou porque a área dela é secreta e não me foi enviada". As duas
 * situações são indistinguíveis sem uma lista de públicas — e tratar a segunda
 * como pública seria abrir a exceção justamente onde ela dói.
 *
 * Com a lista, o desconhecido cai no padrão fechado (`PADRAO_DESCONHECIDO`):
 * exige sessão, sem exigir perfil específico. É o veredito certo para a área
 * administrativa sob apelido — quem chegou lá já passou pelo gate do servidor,
 * então tem sessão; e é o veredito certo para uma página nova que ninguém
 * cadastrou, que passa a pedir login em vez de abrir para o mundo.
 */
const PAGINAS_PUBLICAS = Object.freeze([
    '/',
    '/index.html',
    '/html/404.html',
    '/html/500.html',
    '/html/offline.html',
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
    '/html/pages/cadastro-diretor-publico.html',
    '/html/pages/cadastro-docente.html',
    '/html/pages/cadastro-responsavel.html',
    '/html/pages/cadastro-secretaria-publico.html',
    '/html/pages/primeiro-acesso.html',
]);

/**
 * Veredito de uma página que a matriz não conhece.
 *
 * `perfis: null` significa "qualquer perfil autenticado serve" — e não "todos
 * os perfis", que precisaria de uma lista e ficaria desatualizada no dia em que
 * o enum crescesse. Falha FECHADA em relação ao anônimo, ABERTA em relação ao
 * perfil: negar por perfil aqui bloquearia o admin na própria área dele, já que
 * é exatamente ela que não vai para o navegador.
 */
const PADRAO_DESCONHECIDO = Object.freeze({ exigeSessao: true, perfis: null });

/**
 * Normaliza um caminho para comparação: barras invertidas viram barras, barras
 * repetidas colapsam, barra final some, caixa unificada.
 *
 * É a MESMA normalização do espelho no navegador (`js/guarda-acesso.js`), e o
 * teste de paridade existe para que continue sendo. O servidor faz mais do que
 * isto — decodifica em cascata e considera várias formas intermediárias, ver
 * `formasDoCaminho` — porque lá a pergunta é "de que jeitos esta URL pode ser
 * lida até chegar ao disco", que no navegador não se coloca: `location.pathname`
 * já vem decodificado uma vez e não vai virar arquivo nenhum.
 */
function normalizarCaminho(caminho) {
    let s = String(caminho || '/').replace(/\\/g, '/');
    s = s.replace(/\/{2,}/g, '/');
    if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
    return s.toLowerCase();
}

/** Um caminho pertence ao prefixo? Igualdade exata ou segmento completo — */
/*  '/html/administrativo' NÃO pode casar com o prefixo '/html/admin'.       */
function dentroDe(caminho, prefixo) {
    return caminho === prefixo || caminho.startsWith(`${prefixo}/`);
}

/** Último segmento do caminho, em caixa baixa. */
function arquivoDe(caminho) {
    const partes = normalizarCaminho(caminho).split('/');
    return partes[partes.length - 1] || '';
}

/**
 * A regra que governa um caminho, ou `null` quando ele não está em área
 * restrita nenhuma.
 *
 * @param {string} caminho Caminho JÁ normalizado, ou normalizável.
 * @returns {{prefixo: string, config: object}|null}
 */
function regraDe(caminho) {
    const alvo = normalizarCaminho(caminho);
    for (const [prefixo, config] of Object.entries(AREAS)) {
        if (dentroDe(alvo, prefixo)) return { prefixo, config };
    }
    return null;
}

/**
 * Perfis autorizados a abrir um caminho, com a exceção por arquivo vencendo a
 * área que a contém.
 *
 * @param {string} caminho
 * @returns {string[]|null} Lista de perfis, ou `null` para "não há restrição de
 *          perfil" — que é o caso tanto das páginas públicas quanto do padrão
 *          desconhecido. Quem precisa distinguir os dois chama `vereditoDe`.
 */
function perfisPermitidos(caminho) {
    const regra = regraDe(caminho);
    if (!regra) return null;
    const arquivo = arquivoDe(caminho);
    const excecao = regra.config.excecoes && regra.config.excecoes[arquivo];
    return excecao || regra.config.perfis;
}

/**
 * Veredito completo sobre um caminho, na forma que servidor e navegador
 * consultam.
 *
 * @param {string} caminho
 * @returns {{publica: boolean, exigeSessao: boolean, perfis: string[]|null,
 *            redirecionarAoPainel: boolean, semSessao: boolean}}
 */
function vereditoDe(caminho) {
    const alvo = normalizarCaminho(caminho);

    // A tela de login da área é alcançável sem sessão — ver PAGINAS_SEM_SESSAO.
    //
    // A checagem é por NOME DE ARQUIVO e vem ANTES da busca por área, o que
    // parece amplo demais até se olhar de onde a pergunta vem. No servidor a
    // isenção só é consultada dentro de uma área, porque fora dela não há gate
    // nenhum a isentar. No navegador é diferente: sob `ADMIN_PATH` a tela de
    // login da administração chega como `/html/<segredo>/entrar.html`, um
    // caminho que o guard não reconhece como área — a área admin não vai para o
    // navegador de propósito. Sem esta linha ela cairia no padrão fechado e o
    // guard mandaria para o login a única página que EXISTE para fazer login.
    //
    // Avaliar por arquivo aqui mantém os dois lados com o mesmo veredito sem
    // que o navegador precise saber o prefixo. O custo é uma página chamada
    // `entrar.html` fora de área ficar dispensada de sessão — que é o que ela
    // seria de qualquer modo, já que fora de área não há gate.
    if (PAGINAS_SEM_SESSAO.includes(arquivoDe(alvo))) {
        return {
            publica: false,
            exigeSessao: false,
            perfis: null,
            redirecionarAoPainel: false,
            semSessao: true,
        };
    }

    const regra = regraDe(alvo);
    if (regra) {
        return {
            publica: false,
            exigeSessao: true,
            perfis: perfisPermitidos(alvo),
            redirecionarAoPainel: regra.config.redirecionarAoPainel === true,
            semSessao: false,
        };
    }

    if (PAGINAS_PUBLICAS.includes(alvo)) {
        return {
            publica: true,
            exigeSessao: false,
            perfis: null,
            redirecionarAoPainel: false,
            semSessao: false,
        };
    }

    return {
        publica: false,
        exigeSessao: PADRAO_DESCONHECIDO.exigeSessao,
        perfis: PADRAO_DESCONHECIDO.perfis,
        redirecionarAoPainel: false,
        semSessao: false,
    };
}

/**
 * A pergunta do gate, em uma linha.
 *
 * @param {string|null} perfil Perfil do usuário AUTENTICADO, lido do banco.
 *        `null`/vazio representa anônimo.
 * @param {string} caminho
 * @returns {boolean}
 */
function podeAbrir(perfil, caminho) {
    const veredito = vereditoDe(caminho);
    if (veredito.publica || veredito.semSessao) return true;

    const chave = String(perfil || '')
        .trim()
        .toLowerCase();
    if (!chave) return false;
    if (veredito.perfis === null) return true; // basta estar autenticado
    return veredito.perfis.includes(chave);
}

/**
 * A projeção da matriz que PODE ir para o navegador.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O QUE FICA DE FORA, E POR QUÊ
 * ─────────────────────────────────────────────────────────────────────────
 * As áreas marcadas com `segredoDeAmbiente` não saem. Hoje é só `/html/admin`,
 * e o motivo não é a lista de perfis dela — "a área administrativa é para
 * admin" não surpreende ninguém e está no repositório. O motivo é que publicar
 * a REGRA convida a publicar o CAMINHO junto: o guard, para aplicar uma regra
 * de `/html/admin`, precisaria saber que a página onde ele está rodando é uma
 * página de `/html/admin` — e sob `ADMIN_PATH` ela não se chama assim. A única
 * forma de o navegador saber disso seria o servidor contar, que é exatamente o
 * que o apelido existe para evitar.
 *
 * Deixá-la fora não abre buraco nenhum: essas páginas caem em
 * `PADRAO_DESCONHECIDO`, que exige sessão, e o gate do servidor — que é a
 * defesa real — continua conferindo perfil arquivo por arquivo antes de
 * entregar qualquer byte. O guard nunca precisou proteger a área admin; ele
 * precisa não deixar a tela errada piscar, e uma tela que o servidor não
 * entrega não pisca.
 *
 * O prefixo em si (`ADMIN_PATH`) não aparece aqui em forma nenhuma — nem como
 * valor, nem como chave, nem como comprimento. Este arquivo sequer o lê.
 *
 * @returns {{areas: object, publicas: string[], semSessao: string[], paineis: object, painelPadrao: string}}
 */
function matrizPublicavel() {
    const areas = {};
    for (const [prefixo, config] of Object.entries(AREAS)) {
        if (config.segredoDeAmbiente) continue;
        areas[prefixo] = {
            perfis: config.perfis.slice(),
            ...(config.excecoes ? { excecoes: { ...config.excecoes } } : {}),
            ...(config.redirecionarAoPainel ? { redirecionarAoPainel: true } : {}),
        };
    }

    return {
        areas,
        publicas: PAGINAS_PUBLICAS.slice(),
        semSessao: PAGINAS_SEM_SESSAO.slice(),
        // O guard precisa saber para ONDE mandar quem não pode abrir a página.
        // Sem isto ele só saberia negar, e negar sem destino é a tela de erro
        // que `redirecionarAoPainel` existe para evitar.
        paineis: { ...PAINEL_POR_PERFIL },
        painelPadrao: PAINEL_SEM_PERFIL,
    };
}

// `dentroDe`, `arquivoDe` e `PADRAO_DESCONHECIDO` ficam de fora de propósito:
// são detalhes de como a resposta é montada, e exportá-los daria a impressão de
// que existe mais de um jeito legítimo de perguntar. A pergunta se faz por
// `vereditoDe`, `podeAbrir` ou `perfisPermitidos`.
module.exports = {
    AREAS,
    PAGINAS_PUBLICAS,
    PAGINAS_SEM_SESSAO,
    normalizarCaminho,
    regraDe,
    perfisPermitidos,
    vereditoDe,
    podeAbrir,
    matrizPublicavel,
};
