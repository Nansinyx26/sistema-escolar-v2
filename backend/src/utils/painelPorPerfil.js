/**
 * painelPorPerfil.js
 * ============================================================================
 * A CASA DE CADA PERFIL — a tabela que o CONTROLE DE ACESSO consulta.
 *
 * ──────────────────────────────────────────────────────────────────
 * POR QUE ESTA TABELA EXISTE, SE `getRedirectPath` JÁ SABIA DISSO
 * ──────────────────────────────────────────────────────────────────
 * `getRedirectPath` (controllers/UserController.js) sempre soube que o
 * responsável mora no portal — é para lá que ele manda depois do login. Mas
 * esse conhecimento vivia SÓ no controller, usado SÓ no login. Nada impedia o
 * responsável de chegar em `/html/dashboard.html` por outro caminho: um link
 * herdado de uma tela compartilhada, o histórico do navegador, a URL digitada.
 * E o dashboard não conferia perfil nenhum — montava a tela do professor para
 * quem quer que abrisse.
 *
 * "Para onde este perfil vai" e "quem pode abrir esta página" são a MESMA regra
 * vista de dois lados. O gate precisava dela, e um middleware não pode depender
 * de um controller. Daí esta tabela.
 *
 * ──────────────────────────────────────────────────────────────────
 * SIM, A REGRA ESTÁ ESCRITA EM DOIS LUGARES — E ISSO É DELIBERADO
 * ──────────────────────────────────────────────────────────────────
 * O natural seria `getRedirectPath` apenas delegar para cá, e a duplicação
 * sumir por construção. Não foi feito por um motivo externo ao design: o gate
 * de lint do CI é por ARQUIVO, e `UserController.js` carrega ~1000 linhas de
 * dívida de formatação anterior ao Biome. Tocar nele obrigaria a reformatar o
 * controller de autenticação inteiro junto com a correção — um diff em que a
 * mudança real fica invisível para quem revisa.
 *
 * Enquanto essa dívida não for paga num PR `chore:` próprio, o que segura a
 * consistência é um TESTE: `fluxos.test.js` → "destino pós-login e gate de
 * painel concordam" exige que `getRedirectPath` e `painelDoPerfil` devolvam o
 * mesmo destino para todo perfil, e que o gate cubra exatamente quem o login
 * manda ao dashboard. Mexer num lado sem mexer no outro fica vermelho lá.
 *
 * Quando o `UserController.js` for formatado, troque o corpo de
 * `getRedirectPath` por `return painelDoPerfil(user.perfil)` e apague este
 * bloco — o teste de consistência vira redundante e pode ir junto.
 *
 * ──────────────────────────────────────────────────────────────────
 * O gate de verdade é `middleware/protegerPaginas.js`. Este arquivo é só a
 * tabela, e `perfisComPainel()` deriva a lista de acesso do próprio destino —
 * incluir um perfil no dashboard e liberar o dashboard para ele são um gesto só.
 * ============================================================================
 */

/** Painel unificado — adapta a própria interface ao perfil que o abriu. */
const PAINEL_DASHBOARD = '/html/dashboard.html';

/** Tela de escolha, e também o destino de quem não tem perfil resolvido. */
const PAINEL_SEM_PERFIL = '/html/escolher-perfil.html';

/**
 * Destino de cada perfil do enum de `models/Usuario.js`.
 *
 * IMPORTANTE: os caminhos precisam existir de verdade no servidor estático.
 * As páginas vivem em `/html/*`; um path como `/dashboard.html` (na raiz) cai
 * no catch-all do Express e devolve a landing page — causa histórica do bug
 * "voltar para a página inicial" depois do login.
 */
const PAINEL_POR_PERFIL = {
    admin: PAINEL_DASHBOARD,
    diretor: PAINEL_DASHBOARD,
    professor: PAINEL_DASHBOARD,
    secretaria: '/html/secretaria/painel.html',
    responsavel: '/portal-responsavel/dist/index.html',
};

/**
 * Onde este perfil mora.
 *
 * Perfil ausente OU desconhecido cai na tela de escolha — nunca no dashboard.
 * Falha FECHADA, e aqui esta tabela diverge de propósito do `getRedirectPath`,
 * que termina em `return '/html/dashboard.html'`: um perfil novo que ninguém
 * lembrasse de cadastrar ganharia o painel do professor de graça. É exatamente
 * a forma do bug que este arquivo existe para fechar.
 *
 * A divergência não fica solta: `painelPorPerfil.test.js` cobra que TODO perfil
 * do enum de `models/Usuario.js` tenha destino declarado aqui, então o caso
 * "perfil desconhecido" nunca chega a acontecer em produção — ele é barrado no
 * CI, no dia em que o enum crescer.
 *
 * @param {string} perfil Perfil do usuário AUTENTICADO, lido do banco.
 * @returns {string} Caminho absoluto de uma página que existe no disco.
 */
function painelDoPerfil(perfil) {
    const bruto = String(perfil || '').trim();
    return PAINEL_POR_PERFIL[bruto.toLowerCase()] || PAINEL_SEM_PERFIL;
}

/**
 * Quem tem determinada página como painel — quem MORA nela.
 *
 * @param {string} caminho Um dos valores de `PAINEL_POR_PERFIL`.
 * @returns {string[]} Perfis cujo painel é esse caminho.
 */
function perfisComPainel(caminho) {
    return Object.keys(PAINEL_POR_PERFIL).filter((p) => PAINEL_POR_PERFIL[p] === caminho);
}

/**
 * Quem pode ABRIR o dashboard — que não é a mesma pergunta que "quem mora nele".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUE ESTA LISTA NÃO É `perfisComPainel(PAINEL_DASHBOARD)`
 * ─────────────────────────────────────────────────────────────────────────
 * Foi essa exatamente a primeira versão, e ela QUEBROU a secretaria. Derivar o
 * acesso de "quem mora aqui" parece elegante e está errado: a secretaria tem
 * painel próprio (é para lá que o login a manda), mas
 *
 *   • `html/secretaria/painel.html` oferece um botão "Dashboard" no cabeçalho; e
 *   • `js/dashboard.js` tem ramos de secretaria em `atualizarCards` e
 *     `atualizarVisibilidadeSidebar` — a tela sabe se desenhar para ela.
 *
 * Com a lista derivada, aquele botão virava um no-op silencioso: a pessoa
 * clicava e o gate a devolvia para a página de onde saiu. Ninguém pediu isso.
 *
 * O defeito que originou este arquivo era sobre o RESPONSÁVEL — uma conta de
 * família recebendo a interface do professor. "Morar" governa o
 * redirecionamento; "poder abrir" é uma decisão de acesso, e ela é declarada
 * aqui, à mão, com o motivo de cada nome.
 *
 * A relação entre as duas é garantida por teste: todo perfil que MORA no
 * dashboard tem obrigatoriamente de poder abri-lo (senão o próprio login
 * mandaria a pessoa para uma porta fechada), e `responsavel` nunca entra.
 */
const PERFIS_DO_DASHBOARD = Object.freeze([
    // Moram aqui — o dashboard é o destino pós-login dos três.
    'admin',
    'diretor',
    'professor',
    // Visita: tem painel próprio, mas alcança este por um botão do painel dela.
    'secretaria',
]);

module.exports = {
    painelDoPerfil,
    perfisComPainel,
    PAINEL_POR_PERFIL,
    PAINEL_DASHBOARD,
    // Exportado para `utils/matrizAcesso.js`: o guard do navegador precisa do
    // mesmo destino de fallback que `painelDoPerfil` usa, senão um perfil que
    // ele não reconhece ficaria sem para onde ir.
    PAINEL_SEM_PERFIL,
    PERFIS_DO_DASHBOARD,
};
