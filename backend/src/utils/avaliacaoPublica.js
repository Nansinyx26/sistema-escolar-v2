/**
 * avaliacaoPublica.js — o que uma avaliação do sistema mostra fora da conta
 * de quem avaliou (Issue #489).
 *
 * A página inicial é pública e o painel é visto pela rede inteira. Por isso
 * nenhuma saída leva nome completo, foto ou identificador da conta: só
 * iniciais, o papel (responsável, professor…), as estrelas e o texto.
 *
 * Para a PÁGINA INICIAL vale ainda: a pessoa escolheu aparecer
 * (`exibirPublicamente`) e a administração aprovou (`moderacao`).
 */
const MODERACAO = ['pendente', 'aprovada', 'recusada'];

const ROTULO_PERFIL = {
    responsavel: 'Responsável',
    professor: 'Professor(a)',
    diretor: 'Direção',
    secretaria: 'Secretaria',
    admin: 'Administração',
};

/** "Maria da Silva Souza" → "M. S." ; vazio → "Usuário". */
function iniciaisDe(nome) {
    const partes = String(nome || '')
        .trim()
        .split(/\s+/)
        .filter((p) => p.length > 0 && /^\p{L}/u.test(p));
    if (partes.length === 0) return 'Usuário';
    const letras = [partes[0], partes.length > 1 ? partes[partes.length - 1] : null]
        .filter(Boolean)
        .map((p) => `${p[0].toUpperCase()}.`);
    return letras.join(' ');
}

function rotuloPerfil(perfil) {
    return ROTULO_PERFIL[String(perfil || '').toLowerCase()] || 'Usuário';
}

/** Filtro das avaliações que podem ir para a página inicial. */
const FILTRO_PAGINA_INICIAL = { exibirPublicamente: true, moderacao: 'aprovada' };

/** Avaliação da landing (AvaliacaoSistema) → forma pública. */
function avaliacaoParaPublico(a) {
    return {
        _id: a._id,
        nome: iniciaisDe(a.nome),
        perfil: rotuloPerfil(a.perfil),
        estrelas: a.estrelas,
        texto: a.texto,
        dataCriacao: a.dataCriacao,
    };
}

/**
 * Avaliação do painel (SiteReview) → mesmas chaves que o painel já lê, sem
 * `userId` e sem `userAvatar`; `userName` sai como iniciais.
 */
function siteReviewParaPublico(r) {
    return {
        _id: r._id,
        userName: iniciaisDe(r.userName),
        userType: r.userType,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
    };
}

/** Só `true` literal conta como adesão — string, número ou ausência não. */
function aderiu(valor) {
    return valor === true;
}

module.exports = {
    MODERACAO,
    FILTRO_PAGINA_INICIAL,
    iniciaisDe,
    rotuloPerfil,
    avaliacaoParaPublico,
    siteReviewParaPublico,
    aderiu,
};
