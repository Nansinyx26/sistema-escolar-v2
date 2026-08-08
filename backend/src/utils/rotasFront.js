/**
 * rotasFront.js
 * ============================================================================
 * Endereço real de cada página da área administrativa — decidido no SERVIDOR.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO PRECISA EXISTIR
 * ─────────────────────────────────────────────────────────────────────────
 * Os botões do painel montavam o link no HTML: `data-href="admin/usuarios.html"`.
 * Isso funciona enquanto a área mora em /html/admin. Com ADMIN_PATH configurado
 * (o apelido secreto de middleware/protegerPaginas.js), /html/admin/... passa a
 * responder 404 para TODO MUNDO, inclusive admin — de propósito, para o servidor
 * não confirmar que a área existe. O front nunca foi avisado disso, então cada
 * botão do painel virou um 404. Era exatamente esse o sintoma relatado: as
 * páginas não foram renomeadas nem movidas, o prefixo é que mudou.
 *
 * O caminho não pode ser hardcoded no front porque ele É o segredo. Também não
 * pode ser servido a qualquer um: um endpoint público devolvendo o prefixo
 * anula o apelido tão bem quanto um redirect 301 público faria. Por isso o
 * consumo é sempre autenticado e filtrado por perfil (ver routes/auth.js →
 * GET /api/auth/rotas).
 *
 * Ofuscação continua não sendo autorização: o gate de perfil em
 * protegerPaginas.js segue sendo a defesa real. Isto só mantém a navegação
 * coerente com ele.
 * ============================================================================
 */

const { APELIDO_ADMIN } = require('../middleware/protegerPaginas');

const BASE_ADMIN_REAL = '/html/admin';

/**
 * Nome de arquivo de cada página da área. Chave = identificador estável usado
 * pelo front; valor = arquivo em disco. Renomear um arquivo exige mexer AQUI e
 * em nenhum HTML — que é o ponto de ter um mapa central.
 */
const PAGINAS_ADMIN = {
    configuracoes: 'configuracoes.html',
    usuarios: 'usuarios.html',
    codigosEscolas: 'codigos-escolas.html',
    auditoria: 'auditoria.html',
    cadastroSecretaria: 'cadastro-secretaria.html',
    diagnostico: 'diagnostico.html',
    entrar: 'entrar.html',
};

/**
 * Perfis que enxergam cada página. ESPELHA `AREAS['/html/admin']` de
 * protegerPaginas.js — divergir aqui daria um botão que abre e depois toma 404.
 */
const PERFIS_POR_PAGINA = {
    usuarios: ['admin', 'diretor'],
    cadastroSecretaria: ['admin', 'diretor'],
};
const PERFIS_PADRAO_ADMIN = ['admin'];

/** Prefixo em que a área administrativa realmente responde agora. */
function baseAdmin() {
    return APELIDO_ADMIN ? `/html/${APELIDO_ADMIN}` : BASE_ADMIN_REAL;
}

/**
 * Rotas da área administrativa visíveis para um perfil.
 *
 * @param {string} perfil Perfil do usuário AUTENTICADO (lido do banco, nunca do token).
 * @returns {object} Mapa `{ chave: '/caminho/real.html' }`. Vazio para quem não
 *          tem acesso a nenhuma página — assim o prefixo não vaza por omissão.
 */
function rotasAdminPara(perfil) {
    const base = baseAdmin();
    const rotas = {};

    Object.entries(PAGINAS_ADMIN).forEach(([chave, arquivo]) => {
        // A tela de login da área não entra: quem já tem sessão não precisa
        // dela, e mandá-la de volta ao front seria distribuir o prefixo sem
        // necessidade nenhuma.
        if (chave === 'entrar') return;

        const permitidos = PERFIS_POR_PAGINA[chave] || PERFIS_PADRAO_ADMIN;
        if (permitidos.includes(perfil)) rotas[chave] = `${base}/${arquivo}`;
    });

    return rotas;
}

/**
 * Traduz um caminho previsível (/html/admin/x.html) para o caminho real.
 * Devolve `null` quando não há apelido configurado (nada a traduzir) ou quando
 * o caminho não pertence à área.
 */
function traduzirCaminhoPrevisivel(caminho) {
    if (!APELIDO_ADMIN) return null;
    if (caminho !== BASE_ADMIN_REAL && !caminho.startsWith(`${BASE_ADMIN_REAL}/`)) return null;
    return baseAdmin() + caminho.slice(BASE_ADMIN_REAL.length);
}

module.exports = {
    baseAdmin,
    rotasAdminPara,
    traduzirCaminhoPrevisivel,
    PAGINAS_ADMIN,
    PERFIS_POR_PAGINA,
    PERFIS_PADRAO_ADMIN,
    BASE_ADMIN_REAL,
};
