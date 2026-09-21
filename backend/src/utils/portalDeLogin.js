/**
 * portalDeLogin.js
 * ============================================================================
 * POR QUAL PORTA CADA CONTA ENTRA — a regra, e só a regra.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O QUE ESTAVA ABERTO
 * ─────────────────────────────────────────────────────────────────────────
 * O sistema tem duas portas de entrada e elas já eram separadas em quase tudo:
 *
 *   • as telas da escola (`html/login-professor.html`, `login-diretor.html`,
 *     `login-secretaria.html` e `login.html`), com senha e segundo fator; e
 *   • o Portal do Responsável (`portal-responsavel/`), que é a porta da
 *     FAMÍLIA — e que já mandava `portal: 'responsavel'` no corpo do login.
 *
 * `POST /api/auth/login` recebia esse campo e NÃO olhava para ele. Uma conta de
 * responsável que digitasse e-mail e senha na tela do professor recebia sessão
 * completa no domínio da escola: o redirecionamento a devolvia ao portal dela,
 * mas o COOKIE ficava, e com ele toda página da escola que a matriz de acesso
 * não listasse nominalmente (`/html/turma.html`, `/html/planilha-faltas.html`,
 * `/html/lista-professores.html`…) abria, porque o padrão do desconhecido era
 * "basta estar autenticado". O caminho inverso também valia: conta de equipe
 * entrava pelo portal da família.
 *
 * O login com Google (`UserController.googleLogin`) já recusava conta de equipe
 * com 403 e a mensagem "a equipe escolar entra com e-mail e senha no portal da
 * escola". Era o login por SENHA que não tinha o espelho dessa recusa.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ISTO SOZINHO NÃO É A TRAVA — E NÃO PODE SER
 * ─────────────────────────────────────────────────────────────────────────
 * Quem declara o portal é o cliente, e cliente mente: um `curl` sem o campo
 * `portal` continua sendo tratado como escola. Por isso a recusa aqui vale pela
 * porta, não pelo que se alcança depois dela — o que fecha as páginas da escola
 * para a conta de família é `utils/matrizAcesso.js`
 * (PERFIS_SEM_PAGINAS_DA_ESCOLA), aplicado no servidor por
 * `middleware/protegerPaginas.js`, e o que fecha os dados é o `authorize(...)`
 * de cada rota. As três camadas respondem à mesma pergunta em lugares
 * diferentes, e nenhuma delas depende das outras estarem certas.
 *
 * O ganho desta: a pessoa é barrada no ato, com o endereço da porta certa, em
 * vez de entrar e descobrir aos poucos que nada funciona.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ONDE ISTO É CONSULTADO
 * ─────────────────────────────────────────────────────────────────────────
 * `controllers/UserController.js` (o login em uso) e
 * `services/AuthenticationService.js` (o login da refatoração em andamento).
 * Os dois traziam a regra escrita à mão, com textos e códigos diferentes —
 * duas versões da mesma decisão, que é o começo de toda divergência.
 * ============================================================================
 */

/** A porta da equipe escolar: professor, diretor, secretaria e admin. */
const PORTAL_ESCOLA = 'escola';

/** A porta da família. */
const PORTAL_RESPONSAVEL = 'responsavel';

/**
 * Perfis que entram pelo Portal do Responsável. Todo o resto é da escola.
 *
 * Lista dos perfis DA FAMÍLIA, e não dos da escola, de propósito: perfil novo
 * no enum de `models/Usuario.js` nasce como conta de escola, que é o caso
 * comum. Um perfil novo de família precisa ser escrito aqui de propósito — que
 * é exatamente a revisão que se quer obrigar.
 */
const PERFIS_DO_PORTAL_RESPONSAVEL = Object.freeze(['responsavel']);

/** Códigos de recusa. O front reage a `codigo`, nunca ao texto (ver auth.js). */
const CODIGOS_PORTAL = Object.freeze({
    CONTA_DE_RESPONSAVEL: 'CONTA_DE_RESPONSAVEL',
    CONTA_DA_ESCOLA: 'CONTA_DA_ESCOLA',
});

/**
 * A porta de uma conta.
 *
 * @param {string} perfil Perfil lido do BANCO, nunca do que o cliente mandou.
 * @returns {'escola'|'responsavel'}
 */
function portalDoPerfil(perfil) {
    const chave = String(perfil || '')
        .trim()
        .toLowerCase();
    return PERFIS_DO_PORTAL_RESPONSAVEL.includes(chave) ? PORTAL_RESPONSAVEL : PORTAL_ESCOLA;
}

/**
 * A porta que o cliente diz estar usando.
 *
 * Qualquer valor que não seja `responsavel` — inclusive o campo ausente — é a
 * escola. O padrão é esse e não o contrário porque o Portal do Responsável é o
 * único cliente que declara o campo hoje: quem não declara, ou é uma tela da
 * escola ou é alguém falando direto com a API, e nos dois casos "escola" é a
 * leitura que FECHA a porta para a conta de família em vez de abri-la.
 *
 * @param {*} valorBruto `req.body.portal`, em qualquer formato.
 * @returns {'escola'|'responsavel'}
 */
function portalDaRequisicao(valorBruto) {
    const bruto = String(valorBruto == null ? '' : valorBruto)
        .trim()
        .toLowerCase();
    // 'docente' é o nome antigo da porta da escola, usado por
    // `AuthenticationService.login(email, senha, portal = 'docente')`. Mantido
    // aqui como sinônimo para que a troca de nome não vire recusa.
    if (bruto === PORTAL_RESPONSAVEL) return PORTAL_RESPONSAVEL;
    return PORTAL_ESCOLA;
}

/**
 * A conta pode entrar por esta porta?
 *
 * @param {string} perfil Perfil lido do banco.
 * @param {*} portalPedido `req.body.portal`.
 * @returns {boolean}
 */
function portalConfere(perfil, portalPedido) {
    return portalDoPerfil(perfil) === portalDaRequisicao(portalPedido);
}

/**
 * A recusa pronta, já com o endereço da porta certa.
 *
 * O texto NÃO revela nada que quem chegou aqui ainda não saiba: esta função só
 * é chamada depois de a senha correta ter sido apresentada, então não há
 * enumeração a proteger — e dizer "vá para o outro portal" é a única resposta
 * que resolve o problema de quem errou a tela de boa-fé, que é o caso comum.
 *
 * @param {string} perfil Perfil lido do banco.
 * @returns {{codigo: string, error: string, portalCorreto: string}}
 */
function recusaDePortal(perfil) {
    if (portalDoPerfil(perfil) === PORTAL_RESPONSAVEL) {
        return {
            codigo: CODIGOS_PORTAL.CONTA_DE_RESPONSAVEL,
            error: 'Esta é uma conta de responsável. Entre pelo Portal do Responsável.',
            portalCorreto: PORTAL_RESPONSAVEL,
        };
    }
    return {
        codigo: CODIGOS_PORTAL.CONTA_DA_ESCOLA,
        error: 'Esta é uma conta da equipe escolar. Entre pela página de login da escola.',
        portalCorreto: PORTAL_ESCOLA,
    };
}

module.exports = {
    PORTAL_ESCOLA,
    PORTAL_RESPONSAVEL,
    PERFIS_DO_PORTAL_RESPONSAVEL,
    CODIGOS_PORTAL,
    portalDoPerfil,
    portalDaRequisicao,
    portalConfere,
    recusaDePortal,
};
