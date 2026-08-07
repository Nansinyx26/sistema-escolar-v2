const path = require('path');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const JWT_SECRET = require('../utils/jwtConfig');
const Usuario = require('../models/Usuario');
const { tokenEstaRevogado } = require('../utils/sessionToken');
const logger = require('../utils/logger');

/**
 * Controle de acesso às ÁREAS RESTRITAS do site, no servidor.
 *
 * Antes, /html/admin, /html/secretaria, /html/direcao e /direcao eram servidos
 * por `express.static` sem gate nenhum: quem digitasse a URL recebia o HTML e o
 * JS inteiros. Onde existia checagem, ela vivia DENTRO da página
 * (`if (user.perfil !== 'admin') ...`), o que roda depois de o arquivo já estar
 * no navegador — é aparência, não autorização.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE MIDDLEWARE É GLOBAL, E NÃO MONTADO EM `app.use('/html/admin')`
 * ─────────────────────────────────────────────────────────────────────────
 * A primeira versão usava montagem por prefixo e era CONTORNÁVEL. O Express
 * casa o mount contra o caminho como veio na requisição, enquanto o
 * express.static resolve o arquivo depois de decodificar e normalizar. Quem
 * decide e quem entrega enxergavam strings diferentes — e quatro URLs entregavam
 * a página inteira para um anônimo:
 *
 *     /html//admin/usuarios.html        (barra duplicada)
 *     /html/%61dmin/usuarios.html       (%61 = 'a')
 *     /html/ad%6Din/usuarios.html       (%6D = 'm')
 *     /html/admin%2Fusuarios.html       (%2F = '/')
 *
 * Agora a decisão é tomada sobre o caminho NORMALIZADO — decodificado em
 * cascata, com barras invertidas convertidas, barras repetidas colapsadas,
 * `.`/`..` resolvidos e caixa unificada — e basta UMA das formas intermediárias
 * cair numa área restrita para o gate valer. A regra é fail-closed: na dúvida,
 * bloqueia. Codificação malformada (%ZZ) vira 400 em vez de seguir adiante.
 *
 * TODOS os arquivos da área passam pelo gate, não só os .html: um `.js` de
 * página administrativa carrega tanta informação quanto o HTML, e foi assim que
 * os scripts .py de /direcao ficaram públicos. Isso não quebra a tela do usuário
 * legítimo — ele recebeu a página com o cookie, e o navegador manda o mesmo
 * cookie ao buscar os assets.
 *
 * Os perfis de cada área espelham o `authorize(...)` da API correspondente
 * (routes/secretaria.js, diretores.js, audit.js, escolas.js). Divergir daria
 * uma tela que abre e depois falha em toda chamada.
 */

/**
 * Mapa das áreas restritas. O perfil mais restrito é sempre o padrão da área,
 * então uma página nova nasce protegida sem depender de alguém cadastrá-la.
 * As chaves DEVEM estar em minúsculas — a comparação é feita em caixa baixa.
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
    },
    // Espelha authorize('secretaria', 'diretor', 'admin') em routes/secretaria.js
    '/html/secretaria': { perfis: ['admin', 'diretor', 'secretaria'] },
    '/html/direcao': { perfis: ['admin', 'diretor'] },
    '/direcao': {
        perfis: ['admin', 'diretor'],
        excecoes: {
            // Os códigos secretos de cadastro de docente são admin-only na API
            // (routes/escolas.js → authorize('admin')).
            'codigos-secretos.html': ['admin'],
            'codigos-secretos.js': ['admin'],
        },
    },
};

/**
 * Apelido secreto da área administrativa, vindo do ambiente.
 *
 * Com `ADMIN_PATH=f3a91c7d5e`, a área passa a viver em /html/f3a91c7d5e/… e o
 * caminho previsível /html/admin/… responde 404 para TODO MUNDO, inclusive
 * admin. Sem a variável, nada muda — o padrão continua /html/admin.
 *
 * IMPORTANTE, para não gerar falsa confiança: isto é ofuscação, não
 * autorização. Quem descobrir o caminho continua barrado pelo gate abaixo, que
 * é a defesa real. O ganho concreto é sair do espaço de URLs que scanner
 * automático e curioso testam primeiro, e não deixar o 302 do login confirmar
 * que a área existe. Por isso o valor mora no ambiente e não no fonte: no
 * código, ele seria só mais uma string legível para quem tem o repositório.
 */
const APELIDO_ADMIN = (process.env.ADMIN_PATH || '').trim().replace(/^\/+|\/+$/g, '');
const AREA_ADMIN_REAL = '/html/admin';

/**
 * Todas as formas pelas quais um caminho pode ser interpretado até chegar ao
 * disco. Devolve `null` quando a URL tem codificação inválida — o chamador
 * trata isso como requisição rejeitada, nunca como "não é área restrita".
 *
 * Cada forma traz duas versões: `comparacao` em caixa baixa (o roteamento do
 * Express e o disco no Windows são case-insensitive) e `real`, que preserva a
 * caixa original e é a única que pode ser reescrita em `req.url` — em Linux,
 * que é o sistema do Render, o arquivo não é encontrado com a caixa trocada.
 */
function formasDoCaminho(caminhoBruto) {
    const brutas = [];
    let atual = caminhoBruto;

    // Decodifica em cascata: o static decodifica uma vez, mas aceitar mais
    // níveis aqui só amplia o bloqueio, e é o lado seguro do erro.
    for (let i = 0; i < 3; i++) {
        brutas.push(atual);
        let decodificado;
        try {
            decodificado = decodeURIComponent(atual);
        } catch (e) {
            return null; // %ZZ e afins
        }
        if (decodificado === atual) break;
        atual = decodificado;
    }

    return brutas.map((forma) => {
        let s = forma.replace(/\\/g, '/');   // separador do Windows
        s = s.replace(/\/{2,}/g, '/');       // //admin → /admin
        s = path.posix.normalize(s);         // resolve . e ..
        if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
        return { real: s, comparacao: s.toLowerCase() };
    });
}

/** Um caminho pertence ao prefixo? Igualdade exata ou segmento completo — */
/*  '/html/administrativo' NÃO pode casar com o prefixo '/html/admin'.       */
function dentroDe(caminho, prefixo) {
    return caminho === prefixo || caminho.startsWith(`${prefixo}/`);
}

/** Encontra a área restrita correspondente, se houver. */
function areaDe(formas) {
    for (const forma of formas) {
        for (const [prefixo, config] of Object.entries(AREAS)) {
            if (dentroDe(forma.comparacao, prefixo)) {
                return { prefixo, config, forma: forma.comparacao };
            }
        }
    }
    return null;
}

/**
 * Resolve o apelido secreto. Devolve:
 *   { rota: '/html/admin/x.html' }  → reescrever req.url para este caminho
 *   { bloquear: true }              → caminho previsível, morto quando há apelido
 *   null                            → não tem relação com a área admin
 */
function resolverApelido(formas) {
    if (!APELIDO_ADMIN) return null;
    const apelido = `/html/${APELIDO_ADMIN.toLowerCase()}`;

    for (const forma of formas) {
        if (dentroDe(forma.comparacao, apelido)) {
            // Reescreve preservando a caixa do restante do caminho.
            const resto = forma.real.slice(`/html/${APELIDO_ADMIN}`.length);
            return { rota: AREA_ADMIN_REAL + resto };
        }
        // Com apelido ativo, o nome previsível deixa de existir para todos.
        // Um 404 aqui (em vez do 302 para o login) impede que a resposta
        // confirme que a área administrativa existe neste servidor.
        if (dentroDe(forma.comparacao, AREA_ADMIN_REAL)) {
            return { bloquear: true };
        }
    }
    return null;
}

function extrairToken(req) {
    if (req.cookies && req.cookies.escola_jwt) return req.cookies.escola_jwt;
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
        const valor = auth.split(' ')[1];
        if (valor && valor !== 'null' && valor !== 'undefined') return valor;
    }
    return null;
}

async function autorizar(req, res, next, { config, forma }, pagina404) {
    const arquivo = path.basename(forma);
    const perfisPermitidos = (config.excecoes && config.excecoes[arquivo]) || config.perfis;
    const token = extrairToken(req);

    if (!token) {
        return res.redirect(302, `/html/login.html?next=${encodeURIComponent(req.originalUrl)}`);
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        // O token pré-2FA é assinado com o mesmo segredo e não pode valer como
        // sessão completa — mesma trava do authJWT.
        if (decoded.purpose && decoded.purpose !== 'session') {
            return res.redirect(302, '/html/login.html');
        }
        if (await tokenEstaRevogado(decoded)) {
            return res.redirect(302, '/html/login.html');
        }

        // Perfil lido do BANCO, nunca do token: um rebaixamento vale já na
        // próxima requisição, sem esperar o cookie expirar.
        const usuario = await Usuario.findById(decoded.id || decoded._id)
            .select('tokenVersion ativo perfil')
            .lean();

        const versaoConta = usuario?.tokenVersion !== undefined ? usuario.tokenVersion : 0;
        const versaoToken = decoded.tokenVersion !== undefined ? decoded.tokenVersion : 0;

        if (!usuario || usuario.ativo === false || versaoConta !== versaoToken) {
            return res.redirect(302, '/html/login.html');
        }

        if (!perfisPermitidos.includes(usuario.perfil)) {
            logger.warn('Acesso negado a área restrita', {
                arquivo, perfil: usuario.perfil, action: 'protegerPaginas.negado',
            });
            // 404 e não 403: um 403 confirmaria que a área existe.
            return res.status(404).sendFile(pagina404);
        }

        return next();
    } catch (e) {
        logger.warn('Token inválido em área restrita', {
            arquivo, errName: e.name, action: 'protegerPaginas.tokenInvalido',
        });
        return res.redirect(302, '/html/login.html');
    }
}

/**
 * Middleware único, registrado ANTES do express.static.
 * Requisições fora das áreas restritas saem na primeira comparação de string.
 */
function protegerAreasRestritas(frontendRootPath) {
    const pagina404 = path.join(frontendRootPath, 'html', '404.html');
    const parseCookies = cookieParser();

    return function (req, res, next) {
        let formas = formasDoCaminho(req.path);

        if (formas === null) {
            // URL com codificação inválida. Seguir adiante deixaria o static
            // interpretá-la por conta própria — exatamente o descasamento que
            // este middleware existe para eliminar.
            return res.status(400).send('Requisição inválida.');
        }

        const apelido = resolverApelido(formas);
        if (apelido) {
            if (apelido.bloquear) return res.status(404).sendFile(pagina404);

            // Reescreve para o caminho real ANTES do static, preservando a
            // query string. A partir daqui o resto do pipeline — inclusive o
            // gate logo abaixo — enxerga /html/admin/…
            const query = req.url.slice(req.path.length);
            req.url = apelido.rota + query;
            formas = formasDoCaminho(req.path);
            if (formas === null) return res.status(400).send('Requisição inválida.');
        }

        const area = areaDe(formas);
        if (!area) return next();

        // Cookies só são parseados quando a requisição é de área restrita: o
        // cookieParser global é registrado depois dos estáticos.
        return parseCookies(req, res, () => autorizar(req, res, next, area, pagina404));
    };
}

module.exports = {
    protegerAreasRestritas, AREAS, formasDoCaminho, areaDe, APELIDO_ADMIN,
};
