/**
 * middleware/bloquearPalavroes.js
 *
 * Barra no servidor qualquer texto com linguagem imprópria ANTES de ele chegar
 * ao controller — portanto antes de virar documento no Mongo, notificação,
 * e-mail ou evento de Socket.IO.
 *
 * A checagem existe também no navegador (js/filtro-palavroes-ui.js), mas
 * aquela é só experiência de uso: quem manda `POST /api/comentarios` pelo
 * console, pelo curl ou por um app antigo não passa por ela. Esta é a que vale.
 *
 * Uso:
 *     const bloquearPalavroes = require('../middleware/bloquearPalavroes');
 *     router.post('/', authJWT, bloquearPalavroes('texto'), Controller.add);
 *     router.post('/', authJWT, bloquearPalavroes(['titulo', 'mensagem']), ...);
 *
 * Resposta ao bloquear (HTTP 400):
 *     {
 *       success: false,
 *       codigo: 'CONTEUDO_IMPROPRIO',
 *       error: 'Sua mensagem contém uma palavra imprópria ...',
 *       detalhes: { campo: 'texto', nivel: 'grave', termos: ['...'], trechos: ['...'] }
 *     }
 *
 * O front usa `codigo` para destacar o campo; `error` é o texto já pronto para
 * o usuário. Os `trechos` devolvidos são os do PRÓPRIO texto enviado — servem
 * para o front grifar o que precisa ser removido.
 *
 * MODO ENXUTO (`{ detalhado: false }`): omite `nivel` e `termos` da resposta.
 * Os `trechos` continuam, porque são o texto que o próprio usuário digitou e
 * sem eles não dá para grifar nada. Já `termos` diz qual entrada do dicionário
 * disparou e `nivel` diz onde está o limiar — juntos, encurtam muito a tentativa
 * e erro de quem está procurando uma grafia que escape. Nos recursos abertos
 * (comentário, avaliação) o detalhe vale a UX; no chat direto entre responsável
 * e escola, não vale. Servidor continua registrando tudo em `registrarTentativa`.
 */

const filtroPalavroes = require('../utils/filtroPalavroes');

/**
 * @param {string|string[]} campos  Campo(s) de `req.body` a inspecionar.
 * @param {Object}  [opcoes]
 * @param {string}  [opcoes.recurso]     Nome do recurso, só para o log.
 * @param {boolean} [opcoes.obrigatorio] Se true, erra quando o campo não é
 *                                       string — o padrão é ignorar campos
 *                                       ausentes (comentário só de áudio,
 *                                       edição parcial etc.).
 * @param {boolean} [opcoes.detalhado]   Se false, omite `nivel` e `termos` da
 *                                       resposta. Padrão true — mudar o padrão
 *                                       quebraria as telas que já leem esses
 *                                       campos.
 */
module.exports = function bloquearPalavroes(campos, opcoes = {}) {
    const lista = Array.isArray(campos) ? campos : [campos];

    return (req, res, next) => {
        if (!req.body || typeof req.body !== 'object') return next();

        for (const campo of lista) {
            const valor = req.body[campo];
            if (typeof valor !== 'string' || valor.trim() === '') continue;

            let resultado;
            try {
                resultado = filtroPalavroes.analisar(valor);
            } catch (erro) {
                // Um defeito no filtro não pode derrubar o envio de mensagens
                // da escola inteira: registra e deixa passar (o pior caso é um
                // palavrão publicado, não o sistema fora do ar).
                require('../utils/logger').error(
                    `[FiltroPalavroes] Falha ao analisar campo "${campo}": ${erro.message}`
                );
                continue;
            }

            if (!resultado.bloquear) continue;

            filtroPalavroes.registrarTentativa(req, {
                campo,
                resultado,
                recurso: opcoes.recurso
            });

            const detalhes = {
                campo,
                trechos: resultado.ocorrencias.map(o => o.trecho)
            };
            if (opcoes.detalhado !== false) {
                detalhes.nivel = resultado.nivel;
                detalhes.termos = resultado.termos;
            }

            return res.status(400).json({
                success: false,
                codigo: 'CONTEUDO_IMPROPRIO',
                error: resultado.mensagem,
                detalhes
            });
        }

        return next();
    };
};
