/**
 * visibilidadeNotificacao.js — quem vê qual Notificacao.
 *
 * O NotificationService grava `destinatarios` como `todos`, `professores`,
 * `responsaveis`, `diretor`/`diretores`, `turma:<id>` e `usuario:<id>`. O
 * filtro antigo do sino só conhecia `todos`, `professores`, `diretores` e ids
 * crus: a resposta a um comentário (`usuario:<id>`) nunca aparecia para quem
 * devia recebê-la, e `turma:<id>` não chegava ao professor da turma.
 *
 * Um filtro só, usado pela leitura e pelas escritas (marcar lida), para as duas
 * concordarem sobre o que é "desta pessoa".
 */

/** Endereçamento pessoal de OUTRA pessoa não aparece para quem só vê o público. */
const NAO_PESSOAL = { $not: /^usuario:/ };

/**
 * Filtro por `id` (`notif_...`) ou `_id`. `_id` só entra quando o valor é um
 * ObjectId de verdade — senão o Mongoose lança CastError e a rota vira 500.
 */
function filtroPorId(id) {
    const valor = String(id);
    const or = [{ id: valor }];
    if (/^[a-f0-9]{24}$/i.test(valor)) or.push({ _id: valor });
    return { $or: or };
}

function paraTurmas(turmas) {
    const lista = [];
    for (const t of turmas || []) {
        if (t === undefined || t === null || t === '') continue;
        lista.push(String(t), `turma:${t}`);
    }
    return lista;
}

/**
 * @param {object} ctx
 * @param {string} ctx.perfil
 * @param {string} ctx.userId
 * @param {string[]} [ctx.turmas]        turmas do professor
 * @param {string[]} [ctx.familia]       destinatários que alcançam os filhos do responsável
 * @returns {object} filtro Mongo
 */
function filtroDoPerfil({ perfil, userId, turmas = [], familia = [] }) {
    const pessoal = userId ? [{ destinatarios: `usuario:${userId}` }] : [];

    if (perfil === 'admin' || perfil === 'secretaria') return {};

    if (perfil === 'professor') {
        return {
            $or: [
                { paraResponsavel: true, destinatarios: NAO_PESSOAL },
                {
                    paraResponsavel: { $ne: true },
                    destinatarios: { $in: ['todos', 'professores', ...paraTurmas(turmas)] },
                },
                ...pessoal,
            ],
        };
    }

    if (perfil === 'diretor') {
        return {
            $or: [
                { paraResponsavel: true, destinatarios: NAO_PESSOAL },
                {
                    paraResponsavel: { $ne: true },
                    destinatarios: { $in: ['todos', 'diretores', 'diretor'] },
                },
                ...pessoal,
            ],
        };
    }

    if (perfil === 'responsavel') {
        // Responsável nunca vê aviso interno: só `paraResponsavel: true` do
        // público dos filhos — ou o que foi endereçado a ele pelo nome.
        return {
            $or: [
                {
                    paraResponsavel: true,
                    destinatarios: { $in: ['todos', 'responsaveis', ...familia] },
                },
                ...pessoal,
            ],
        };
    }

    // Perfil desconhecido não vê nada — fechar é o lado seguro.
    return { _id: null };
}

module.exports = { filtroPorId, filtroDoPerfil, paraTurmas };
