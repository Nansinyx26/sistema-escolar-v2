/**
 * politica2FA.js — quem precisa do segundo fator, decidido num lugar só
 * ============================================================================
 * A regra estava HARDCODED e DUPLICADA em dois arquivos:
 *
 *     UserController.login:      ['diretor','secretaria'].includes(user.perfil)
 *     TwoFactorController.send:  ['diretor','secretaria'].includes(usuario.perfil)
 *
 * Mudar a política exigia achar as duas cópias e um deploy. Agora é uma
 * variável de ambiente, como a Tarefa 7 do roadmap já previa.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DISPENSAR_2FA_EMAIL
 * ─────────────────────────────────────────────────────────────────────────
 * Lista de perfis, separados por vírgula, que entram apenas com e-mail e
 * senha. Vazio (o padrão) = ninguém é dispensado, comportamento de sempre.
 *
 *     DISPENSAR_2FA_EMAIL=diretor,secretaria
 *
 * Ela é AUTORITATIVA: dispensa inclusive contas com `twoFactorEnabled: true`
 * gravado no banco. Foi uma escolha deliberada — meia dispensa (perfil sim,
 * conta não) produziria o caso em que o administrador desliga a exigência e
 * uma conta específica continua trancada, sem nada na tela explicando por quê.
 * Um interruptor só, com efeito previsível.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O QUE VOCÊ PERDE AO LIGAR ISTO
 * ─────────────────────────────────────────────────────────────────────────
 * Diretor e secretaria enxergam nota, frequência e dado pessoal de menor de
 * idade. Com a dispensa ativa, uma senha vazada — reutilizada de outro site,
 * phishing, anotada num papel — vira acesso completo a esses dados, sem
 * nenhuma barreira restante.
 *
 * Por isso: o boot avisa em nível de alerta, e TODO login que pulou o segundo
 * fator entra na auditoria como LOGIN_SEM_2FA. Se um dia for preciso responder
 * "quem entrou sem segundo fator, e quando", a resposta existe.
 *
 * Apagar a variável no painel do Render restaura o 2FA na reinicialização
 * seguinte — sem alterar código, sem novo deploy.
 * ============================================================================
 */

/**
 * Perfis que EXIGEM segundo fator, por configuração.
 *
 * A lista era um array literal aqui dentro. Mudar quem precisa de 2FA exigia
 * editar código e fazer deploy — o que, na prática, significa que ninguém muda.
 *
 * `PERFIS_2FA_OBRIGATORIO=diretor,secretaria,admin`
 *
 * O padrão preserva o comportamento anterior (diretor e secretaria), para que
 * um deploy sem a variável não afrouxe nada por omissão. Fail-safe: a ausência
 * de configuração mantém a política mais restritiva que já existia.
 *
 * Para exigir 2FA do ADMIN, acrescente `admin` — mas leia o roteiro de
 * ativação em docs/2FA-OBRIGATORIO.md antes: ligar isso com o canal de e-mail
 * quebrado e sem códigos de backup tranca a conta administrativa fora do
 * sistema, e não há quem destrave de dentro.
 */
const PADRAO_PERFIS_OBRIGATORIO = ['diretor', 'secretaria'];

function perfisComObrigatoriedade() {
    const bruto = (process.env.PERFIS_2FA_OBRIGATORIO || '').trim();
    if (!bruto) return PADRAO_PERFIS_OBRIGATORIO;
    const lista = bruto
        .split(',')
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean);
    // Variável presente mas só com lixo (vírgulas, espaços) volta ao padrão em
    // vez de desligar a exigência — desligar tem de ser explícito, via
    // DISPENSAR_2FA_EMAIL, que grita no boot.
    return lista.length ? lista : PADRAO_PERFIS_OBRIGATORIO;
}

/** Perfis dispensados por configuração de ambiente. */
function perfisDispensados() {
    return (process.env.DISPENSAR_2FA_EMAIL || '')
        .split(',')
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean);
}

/** O perfil está dispensado do segundo fator? */
function dispensado(perfil) {
    if (!perfil) return false;
    return perfisDispensados().includes(String(perfil).toLowerCase());
}

/**
 * Esta conta precisa passar pelo segundo fator neste login?
 *
 * @param {object} usuario Precisa trazer `perfil` e `twoFactorEnabled`.
 * @returns {boolean}
 */
function exigeSegundoFator(usuario) {
    if (!usuario) return false;
    if (dispensado(usuario.perfil)) return false;

    // `twoFactorEnabled` na conta é o que permite o rollout gradual: liga-se o
    // segundo fator numa conta só, valida-se, e só então o perfil inteiro entra
    // na lista da variável de ambiente.
    return (
        Boolean(usuario.twoFactorEnabled) ||
        perfisComObrigatoriedade().includes(String(usuario.perfil || '').toLowerCase())
    );
}

/**
 * Chamado no boot. Retorna a mensagem de alerta quando há dispensa ativa, ou
 * `null` quando a política está íntegra.
 */
/** Resumo da política vigente, para o log de boot. */
function resumoDaPolitica() {
    return (
        `2FA obrigatório para: ${perfisComObrigatoriedade().join(', ')}` +
        (perfisDispensados().length ? ` | DISPENSADO para: ${perfisDispensados().join(', ')}` : '')
    );
}

function avisoDeBoot() {
    const dispensados = perfisDispensados();
    if (!dispensados.length) return null;
    return (
        `2FA DISPENSADO para: ${dispensados.join(', ')}. ` +
        'Estes perfis entram somente com e-mail e senha. ' +
        'Medida temporária — apague DISPENSAR_2FA_EMAIL para restaurar o segundo fator.'
    );
}

/**
 * O perfil admin está coberto pela política como PERFIL — obrigatório pela
 * variável e não dispensado? Quando não está, o segundo fator do admin passa a
 * depender de cada conta ter `twoFactorEnabled`, e o boot precisa contar.
 */
function adminCobertoPelaPolitica() {
    return perfisComObrigatoriedade().includes('admin') && !dispensado('admin');
}

/**
 * Filtro das contas admin ativas que entram só com senha.
 *
 * Com o perfil dispensado, nem `twoFactorEnabled` na conta pede o segundo
 * fator (a dispensa é autoritativa, ver acima) — então toda conta admin ativa
 * conta. Sem dispensa, conta quem não tem o segundo fator ligado na conta.
 */
function filtroAdminSemSegundoFator() {
    const filtro = { perfil: 'admin', ativo: { $ne: false } };
    if (!dispensado('admin')) filtro.twoFactorEnabled = { $ne: true };
    return filtro;
}

/**
 * Aviso de boot para conta admin que entra só com senha (Issue #467).
 *
 * O padrão da política deixa o admin de fora de propósito (ver o roteiro em
 * docs/2FA-OBRIGATORIO.md: ligar a exigência com o e-mail fora tranca a conta
 * administrativa). Deixar de fora não pode ser o mesmo que esquecer: o admin
 * vê todos os alunos e exporta dado governamental, e uma senha vazada dele
 * alcança a rede inteira.
 *
 * Recebe só a QUANTIDADE — nunca e-mail ou nome — para que o aviso possa ir
 * para o log sem PII.
 *
 * @param {number} contasSemSegundoFator admins ativos sem `twoFactorEnabled`.
 * @returns {string|null}
 */
function avisoAdminSemSegundoFator(contasSemSegundoFator) {
    if (adminCobertoPelaPolitica()) return null;
    const total = Number(contasSemSegundoFator) || 0;
    if (total <= 0) return null;
    const contas =
        total === 1 ? '1 conta admin ativa entra' : `${total} contas admin ativas entram`;
    return (
        `${contas} somente com e-mail e senha. ` +
        'Ative o segundo fator conta a conta pelo roteiro de docs/2FA-OBRIGATORIO.md ' +
        'e depois acrescente admin a PERFIS_2FA_OBRIGATORIO.'
    );
}

module.exports = {
    exigeSegundoFator,
    adminCobertoPelaPolitica,
    filtroAdminSemSegundoFator,
    avisoAdminSemSegundoFator,
    dispensado,
    perfisDispensados,
    perfisComObrigatoriedade,
    resumoDaPolitica,
    avisoDeBoot,
    PADRAO_PERFIS_OBRIGATORIO,
};
