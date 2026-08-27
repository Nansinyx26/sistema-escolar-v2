/**
 * codigoEscolaService — geração e validação do código secreto de cadastro.
 *
 * POR QUE ISTO SAIU DO SecurityController
 * =======================================
 * A regra vivia como método do controller, e todo mundo que precisava validar
 * um código chamava `SecurityController.validateCode(...)`. Para um controller
 * ou uma rota isso é legítimo. Para um SERVICE não é: o contrato de camadas
 * (`service-nao-sobe`, em .dependency-cruiser.cjs) proíbe `services/` importar
 * `controllers/`, e com razão — é assim que nasce ciclo e é assim que a regra
 * de negócio fica presa a um objeto de transporte HTTP.
 *
 * O efeito prático dessa amarra era pior que arquitetural: o
 * `RegistrationService` — que também cadastra docente com código secreto —
 * tinha a validação COMENTADA, com um TODO no lugar. Ninguém pagou o preço
 * ainda porque aquele service está órfão (nenhuma rota o alcança), mas o dia
 * em que alguém ligasse as rotas do UserController refatorado, o cadastro de
 * professor aceitaria qualquer código.
 *
 * A regra não podia descer para `utils/` porque precisa dos models Escola e
 * SecurityConfig, e `transversal-nao-desce` proíbe `utils/` importar `models/`.
 * `services/` é a única camada que pode ler model E ser lida por controller.
 *
 * `SecurityController.generateCode` e `.validateCode` continuam existindo e
 * delegam para cá — os callers de fora (UserController, routes/escolas.js,
 * index.js, testes) não mudaram uma linha.
 */

const SecurityConfig = require('../models/SecurityConfig');
const Escola = require('../models/Escola');
const crypto = require('node:crypto');

/**
 * Gera um novo código de cadastro.
 *
 * O ALFABETO NÃO TEM CARACTERES ESPECIAIS — de propósito.
 * ======================================================
 * A versão anterior sorteava de `!@#$%&*_+-=`. Como o código sempre chega
 * ao servidor DENTRO DO CORPO da requisição (validate-code,
 * register-diretor, register-secretaria, escolas/mudar), ele passa antes
 * pela sanitização global do app.js, que roda `sanitize-html` em toda
 * string do body. E ali:
 *     'aB3&xY9'  →  'aB3&amp;xY9'      (reescrito)
 *     'k#7$mQ<w' →  'k#7$mQ'           (truncado!)
 * O valor comparado em `validarCodigoEscola` nunca batia com o gravado no
 * banco. Com `&` no alfabeto de 73 chars e 10 posições, ~13% dos códigos
 * gerados nasciam INUTILIZÁVEIS — o cadastro rejeitava um código correto e
 * não havia sintoma que apontasse para a causa.
 *
 * Este é o mesmo alfabeto de `gerarCodigoEscola` (routes/escolas.js) e do
 * seed: sem caracteres ambíguos (0/O, 1/I/l), porque o código é ditado por
 * telefone e transcrito à mão. 53^10 ≈ 2^57 de espaço — entropia de sobra
 * para um segredo rotacionável.
 */
function gerarCodigo(length = 10) {
    const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let code = '';
    for (let i = 0; i < length; i++) {
        code += ALFABETO[crypto.randomInt(ALFABETO.length)];
    }
    return code;
}

/**
 * Valida o código secreto de cadastro.
 *
 * Multi-escola:
 * - Com `escolaId`: o código deve bater com o codigoSecreto DAQUELA escola
 *   (evita inconsistência entre a escola clicada no modal e o código digitado).
 * - Sem `escolaId`: o código identifica a escola automaticamente
 *   (busca Escola por codigoSecreto).
 * - Transição/legado: o código global (CONFIG_GERAL, rotação diária)
 *   continua aceito e resolve para a escola ativa única (Jaguari).
 *
 * Retorno: `false` se inválido; senão um objeto `{ escola }` onde
 * `escola` é o doc da Escola resolvida (ou `null` no modo legado puro,
 * quando ainda não há escolas cadastradas). Truthy = válido, preservando
 * os callers que fazem `if (!isValidCode)`.
 */
async function validarCodigoEscola(code, escolaId = null) {
    const codeStr = String(code);

    // Código global legado (rotacionado diariamente)
    let config = await SecurityConfig.findOne({ chave: 'CONFIG_GERAL' });
    if (!config) {
        const novoCodigo = gerarCodigo();
        config = await SecurityConfig.create({
            codigoSecretoEscola: novoCodigo,
            dataUltimaRotacao: new Date(),
            rotacaoAutomatica: true,
        });
        console.log('🔑 [SECURITY] Código secreto global criado.');
    }
    const matchGlobal = config.codigoSecretoEscola === codeStr;

    // 1. Escola pré-selecionada (clique no modal): código deve ser DELA
    if (escolaId) {
        const escola = await Escola.findById(escolaId)
            .select('+codigoSecreto nome ativo')
            .catch(() => null);
        if (!escola?.ativo) return false;
        if (escola.codigoSecreto === codeStr) return { escola };
        // Transição: código global vale para a escola ativa única
        if (matchGlobal) {
            const ativas = await Escola.countDocuments({ ativo: true });
            if (ativas === 1) return { escola };
        }
        return false;
    }

    // 2. Sem escola pré-selecionada: o código identifica a escola
    const escolaPorCodigo = await Escola.findOne({ codigoSecreto: codeStr, ativo: true }).select(
        '+codigoSecreto nome ativo'
    );
    if (escolaPorCodigo) return { escola: escolaPorCodigo };

    // 3. Legado: código global → escola ativa única (ou nenhuma escola cadastrada)
    if (matchGlobal) {
        const ativas = await Escola.find({ ativo: true }).select('nome').limit(2);
        if (ativas.length === 1) return { escola: ativas[0] };
        if (ativas.length === 0) return { escola: null }; // pré-migração
    }
    return false;
}

module.exports = { gerarCodigo, validarCodigoEscola };
