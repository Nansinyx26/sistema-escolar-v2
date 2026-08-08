/**
 * perfilRotulo.js
 * ============================================================================
 * Nome de exibição de cada perfil — decidido no SERVIDOR.
 *
 * O front tinha quatro mapas divergentes e um deles rotulava a conta admin como
 * "PROFESSOR(A)". A correção do lado do cliente (js/auth.js → resolverPerfilAtivo)
 * unifica a decisão, mas o texto em si não deveria ser inferido lá: mudar a
 * nomenclatura institucional ("Secretário(a)" → "Secretaria Escolar") passaria a
 * exigir deploy do front e acerto em cada tela.
 *
 * Por isso o backend passa a mandar `perfilRotulo` junto do `perfil` em
 * /api/auth/login e /api/auth/me. O mapa do front vira apenas a rede de
 * segurança para respostas de uma versão anterior do servidor.
 *
 * As chaves espelham o enum de models/Usuario.js. Um perfil fora do enum
 * devolve `null` — nunca um palpite; quem consome exibe '—'.
 * ============================================================================
 */

const ROTULOS = {
    admin: 'Administrador(a)',
    diretor: 'Diretor(a)',
    secretaria: 'Secretário(a)',
    professor: 'Professor(a)',
    responsavel: 'Responsável',
};

/**
 * @param {string} perfil Valor do campo `perfil` do documento de usuário.
 * @returns {string|null} Rótulo de exibição, ou null se o perfil for desconhecido.
 */
function rotuloDoPerfil(perfil) {
    if (typeof perfil !== 'string') return null;
    const chave = perfil.trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(ROTULOS, chave) ? ROTULOS[chave] : null;
}

module.exports = { rotuloDoPerfil, ROTULOS };
