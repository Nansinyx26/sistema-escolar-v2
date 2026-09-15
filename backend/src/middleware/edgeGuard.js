/**
 * edgeGuard.js — proteção de BORDA da aplicação.
 *
 * PROBLEMA QUE ISTO RESOLVE
 * -------------------------
 * `rateLimiters.js` protege ENDPOINTS: login, código, IA, chat, upload. Só que
 * o `globalLimiter` tem `skip: (req) => !req.path.startsWith('/api')` — ou
 * seja, TUDO que não é API entrava sem teto nenhum:
 *
 *   • os ~66 HTML e os diretórios estáticos (`css/`, `js/`, `img/`, …);
 *   • o gate de páginas restritas, que resolve caminho e lê sessão;
 *   • e principalmente o 404 global, que faz `sendFile(html/404.html)` — uma
 *     LEITURA DE DISCO por requisição desconhecida.
 *
 * Um scanner de vulnerabilidade dispara centenas de caminhos inexistentes
 * (`/wp-admin/setup-config.php`, `/.env`, `/vendor/phpunit/…`). Cada um deles
 * atravessava a cadeia inteira — compressão, logger, helmet com hash de CSP,
 * gate de páginas — e terminava lendo um arquivo do disco. No plano free do
 * Render (CPU compartilhada, 512 MB) isso basta para degradar o site para quem
 * está usando de verdade, sem explorar falha nenhuma.
 *
 * Este módulo é a camada que normalmente ficaria num CDN/WAF (Cloudflare e
 * similares). Como aqui não há domínio próprio nem borda externa, ela roda
 * DENTRO do processo, o mais cedo possível na cadeia, e é organizada para que
 * o custo de rejeitar cresça o MENOS possível com o volume do ataque:
 *
 *   1. banimento    — Map O(1). Requisição de IP banido morre antes de
 *                     compressão, log e qualquer I/O.
 *   2. método       — allowlist de verbos. TRACE/PROPFIND/CONNECT saem aqui.
 *   3. armadilha    — caminhos-isca anunciados no robots.txt. Ban imediato.
 *   4. sondagem     — assinaturas de scanner no caminho/query. 404 opaco.
 *   5. user-agent   — ferramenta de ataque e scraper caro saem; preview de
 *                     link (WhatsApp/Telegram) e buscador legítimo passam.
 *   6. taxa         — teto por IP em TODAS as rotas, em duas janelas
 *                     (rajada e sustentada), não só em `/api`.
 *
 * Cada bloqueio soma PONTOS ao IP. Passou do limiar, o IP é banido por um
 * tempo que dobra a cada reincidência. É isso que troca "reavaliar o atacante
 * a cada request" por "um lookup em Map" enquanto o ataque dura.
 *
 * LIMITES CONHECIDOS (documentados de propósito)
 * ----------------------------------------------
 * • O estado é do PROCESSO. Com mais de uma instância no Render, cada uma tem
 *   seu próprio contador — o efeito prático é um limiar N vezes maior, não uma
 *   falha. Para estado compartilhado seria preciso um store em Redis/Mongo.
 * • A escola inteira costuma sair por UM IP (NAT). Por isso o estouro do teto
 *   de taxa pontua no máximo uma vez por janela — ver `registrarEstouroDeTaxa`.
 *   E `EDGE_ALLOWLIST_IPS` isenta os IPs fixos da escola. Ver
 *   docs/PROTECAO-BORDA.md.
 * • Nada disto substitui autenticação nem os limiters por endpoint. É filtro
 *   de VOLUME e de RUÍDO automatizado — camada a mais, não no lugar de.
 *
 * PII: este módulo nunca loga o endereço IP em claro (é dado pessoal sob a
 * LGPD, e este sistema atende menores). O que vai para o log é `ipHash` — 12
 * hex de um SHA-256 com sal do processo. Dá para correlacionar linhas do mesmo
 * ofensor dentro de uma execução, e não dá para reidentificar ninguém depois.
 */

const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const { chaveIp } = require('./rateLimiters');

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

/**
 * Sal efêmero: o mesmo IP gera hashes diferentes entre execuções, o que impede
 * montar um dicionário do espaço de IPv4 a partir dos logs guardados.
 */
const SAL_DO_PROCESSO = crypto.randomBytes(16);

function hashDoIp(chave) {
    return crypto
        .createHash('sha256')
        .update(SAL_DO_PROCESSO)
        .update(String(chave))
        .digest('hex')
        .slice(0, 12);
}

/** Lê um número do ambiente mantendo o padrão seguro quando ausente/inválido. */
function numeroEnv(nome, padrao) {
    const bruto = Number.parseInt(process.env[nome], 10);
    if (!Number.isFinite(bruto) || bruto <= 0) return padrao;
    return bruto;
}

/** Lê lista separada por vírgula do ambiente. */
function listaEnv(nome) {
    return String(process.env[nome] || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

const UM_SEGUNDO = 1000;
const UM_MINUTO = 60 * UM_SEGUNDO;

// ─────────────────────────────────────────────────────────────────────────────
// PONTUAÇÃO
// ─────────────────────────────────────────────────────────────────────────────
// Um bloqueio isolado não bane: navegador com extensão estranha, link velho
// colado no WhatsApp e crawler mal configurado geram falso positivo. O que
// bane é a REINCIDÊNCIA, e o peso reflete quão inequívoco é o sinal.
const PONTOS = {
    metodo: 8, //        TRACE/PROPFIND — nenhum navegador emite
    sondagem: 10, //     /.env, /wp-admin — 3 destes e o IP sai
    uaAtaque: 25, //     sqlmap/nikto se identificam: 1 requisição basta
    uaScraper: 25, //    scraper de SEO ignorando robots.txt: idem
    taxa: 4, //          por JANELA estourada, nunca por requisição (NAT)
    urlMalformada: 6, // %ZZ inválido — navegador não produz
};

const LIMIAR_DE_BAN = numeroEnv('EDGE_LIMIAR_BAN', 25);

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRO DE ABUSO — pontuação e banimento, com memória limitada
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cria o registro de abuso.
 *
 * A memória é o recurso mais escasso do plano free, e um ataque distribuído é
 * exatamente o cenário em que um Map sem teto vira o próprio incidente: cada
 * IP novo é uma entrada, e quem escolhe quantos IPs mandar é o atacante. Por
 * isso há teto rígido de entradas, varredura periódica e despejo do mais
 * antigo quando o teto é atingido — nessa ordem. Entradas BANIDAS resistem ao
 * despejo, porque são justamente as que estão economizando trabalho.
 *
 * @param {object} opcoes
 * @param {number} [opcoes.maxEntradas] teto de IPs rastreados
 * @param {number} [opcoes.janelaMs]    tempo até os pontos de um IP zerarem
 * @param {number} [opcoes.limiar]      pontos que disparam o banimento
 * @param {number} [opcoes.banBaseMs]   duração do 1º banimento
 * @param {number} [opcoes.banMaxMs]    teto da duração (dobra a cada reincidência)
 * @param {number} [opcoes.memoriaBanMs] por quanto tempo a reincidência é lembrada
 * @param {() => number} [opcoes.agora] injeção de relógio para teste
 */
function criarRegistro({
    maxEntradas = numeroEnv('EDGE_MAX_IPS_RASTREADOS', 5000),
    janelaMs = 10 * UM_MINUTO,
    limiar = LIMIAR_DE_BAN,
    banBaseMs = numeroEnv('EDGE_BAN_MINUTOS', 10) * UM_MINUTO,
    banMaxMs = 12 * 60 * UM_MINUTO,
    memoriaBanMs = numeroEnv('EDGE_MEMORIA_BAN_HORAS', 24) * 60 * UM_MINUTO,
    agora = () => Date.now(),
} = {}) {
    /**
     * @type {Map<string, {pontos:number, expiraEm:number, banidoAte:number,
     *   lembrarAte:number, banimentos:number, janelasDeTaxa:Object<string,string>}>}
     */
    const entradas = new Map();

    /**
     * Uma entrada só pode ser descartada quando as TRÊS coisas venceram: os
     * pontos, o banimento e a memória de reincidência.
     *
     * A terceira é a que não é óbvia. Sem ela, a entrada some assim que a
     * janela de pontos expira — e com ela some o contador `banimentos`, que é
     * justamente o que faz a pena dobrar. O reincidente voltava sempre como se
     * fosse a primeira vez, e o escalonamento, que é o que torna caro insistir,
     * simplesmente não acontecia.
     */
    function vencida(valor, t) {
        return valor.expiraEm <= t && valor.banidoAte <= t && valor.lembrarAte <= t;
    }

    function obter(chave) {
        const t = agora();
        const atual = entradas.get(chave);
        if (!atual) return null;

        if (vencida(atual, t)) {
            entradas.delete(chave);
            return null;
        }

        // Janela de pontos vencida, mas o histórico de banimentos permanece.
        if (atual.expiraEm <= t) atual.pontos = 0;
        return atual;
    }

    function despejarSePreciso() {
        if (entradas.size < maxEntradas) return;
        const t = agora();

        // 1ª passada: o que já venceu.
        for (const [chave, valor] of entradas) {
            if (vencida(valor, t)) entradas.delete(chave);
        }
        if (entradas.size < maxEntradas) return;

        // 2ª passada: os mais antigos NÃO banidos. Map preserva ordem de
        // inserção, então iterar já entrega do mais velho para o mais novo.
        const excedente = entradas.size - maxEntradas + 1;
        let removidos = 0;
        for (const [chave, valor] of entradas) {
            if (removidos >= excedente) break;
            if (valor.banidoAte > t) continue;
            entradas.delete(chave);
            removidos += 1;
        }

        // 3ª passada: se ainda estourou, TODO mundo está banido. Aí o mais
        // antigo sai mesmo assim — perder um ban velho é melhor do que crescer
        // sem limite e derrubar o processo por memória.
        if (entradas.size >= maxEntradas) {
            const primeira = entradas.keys().next();
            if (!primeira.done) entradas.delete(primeira.value);
        }
    }

    function situacaoDe(atual, t) {
        return {
            pontos: atual ? atual.pontos : 0,
            banido: Boolean(atual) && atual.banidoAte > t,
            restanteMs: atual ? Math.max(0, atual.banidoAte - t) : 0,
        };
    }

    const registro = {
        /** @returns {{banido: boolean, restanteMs: number}} */
        situacao(chave) {
            const atual = obter(chave);
            const t = agora();
            if (!atual || atual.banidoAte <= t) return { banido: false, restanteMs: 0 };
            return { banido: true, restanteMs: atual.banidoAte - t };
        },

        /**
         * Soma pontos ao IP e bane se cruzar o limiar.
         * @returns {{pontos:number, banido:boolean, restanteMs:number, novoBanimento:boolean}}
         */
        registrar(chave, pontos) {
            const t = agora();
            let atual = obter(chave);
            if (!atual) {
                despejarSePreciso();
                atual = {
                    pontos: 0,
                    expiraEm: t + janelaMs,
                    banidoAte: 0,
                    lembrarAte: 0,
                    banimentos: 0,
                    janelasDeTaxa: {},
                };
                entradas.set(chave, atual);
            }
            atual.pontos += pontos;
            atual.expiraEm = t + janelaMs;

            const jaBanido = atual.banidoAte > t;
            let novoBanimento = false;

            if (!jaBanido && atual.pontos >= limiar) {
                atual.banimentos += 1;
                const duracao = Math.min(banBaseMs * 2 ** (atual.banimentos - 1), banMaxMs);
                atual.banidoAte = t + duracao;
                // A reincidência é lembrada por bem mais tempo que a pena: é o
                // que faz o próximo banimento do mesmo IP já começar dobrado.
                atual.lembrarAte = atual.banidoAte + memoriaBanMs;
                atual.pontos = 0; // o orçamento reinicia depois de cumprida a pena
                novoBanimento = true;
            }

            return { ...situacaoDe(atual, t), novoBanimento };
        },

        /**
         * Pontua um estouro de teto de taxa — no máximo UMA vez por janela de
         * cada limitador.
         *
         * O `express-rate-limit` chama o handler para CADA requisição acima do
         * teto, não uma vez por janela. Pontuar ali dentro, direto, fazia sete
         * requisições excedentes da MESMA rajada somarem 28 pontos e banirem o
         * IP. Atrás do NAT da escola, isso era quatro pessoas abrindo o painel
         * ao mesmo tempo (~74 recursos cada): o IP público da escola inteira
         * banido por 10 minutos, depois 20, 40… (Issue #332).
         *
         * Com a pontuação por janela, uma rajada vale 4 pontos, e o banimento
         * só vem de estouro SUSTENTADO — sete janelas de 10 s seguidas, pelo
         * menos um minuto de inundação contínua —, que é o que distingue um
         * flood de um laboratório entrando junto na aula.
         *
         * @param {string} chave       IP normalizado
         * @param {string} limitador   nome do limitador ('taxa-rajada', …)
         * @param {string} idDaJanela  identifica a janela corrente do limitador
         */
        registrarEstouroDeTaxa(chave, limitador, idDaJanela) {
            const atual = obter(chave);
            if (atual && atual.janelasDeTaxa[limitador] === idDaJanela) {
                return { ...situacaoDe(atual, agora()), novoBanimento: false, jaPontuada: true };
            }
            const resultado = registro.registrar(chave, PONTOS.taxa);
            const entrada = entradas.get(chave);
            if (entrada) entrada.janelasDeTaxa[limitador] = idDaJanela;
            return { ...resultado, jaPontuada: false };
        },

        /** Bane imediatamente, sem acumular pontos (armadilha). */
        banirAgora(chave) {
            return registro.registrar(chave, limiar);
        },

        /** Remove entradas vencidas. Chamado pela varredura periódica. */
        varrer() {
            const t = agora();
            for (const [chave, valor] of entradas) {
                if (vencida(valor, t)) entradas.delete(chave);
            }
        },

        /** Números para diagnóstico — nunca expõe IP nem hash. */
        resumo() {
            const t = agora();
            let banidos = 0;
            for (const valor of entradas.values()) if (valor.banidoAte > t) banidos += 1;
            return { rastreados: entradas.size, banidos, limiar, maxEntradas };
        },

        /** Só para teste. */
        limpar() {
            entradas.clear();
        },
    };

    return registro;
}

const registroPadrao = criarRegistro();

// A varredura evita que IPs vencidos ocupem espaço até alguém tentar inseri-los.
// `unref()` para não segurar o processo vivo no encerramento nem no Jest.
if (!isTest) {
    const varredura = setInterval(() => registroPadrao.varrer(), 5 * UM_MINUTO);
    if (typeof varredura.unref === 'function') varredura.unref();
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFICADORES (funções puras — testáveis sem subir o app)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verbos que a aplicação usa. O resto (TRACE, TRACK, PROPFIND, CONNECT, DEBUG)
 * ou é reconhecimento de servidor, ou é WebDAV procurando upload aberto. TRACE
 * em particular é o vetor do Cross-Site Tracing. PATCH está na lista porque
 * `/api/chat-direto/lida/:mensagemId` o usa.
 */
const METODOS_PERMITIDOS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

/**
 * Assinaturas de sondagem.
 *
 * A régua para entrar nesta lista: o padrão NÃO PODE existir neste sistema.
 * Não há PHP, não há WordPress, não há Java, e nenhuma rota serve `.sql`,
 * `.env` ou `.pem`. Então requisição assim é, por definição, alguém testando
 * exploit de outro stack — e responder 404 barato é o correto.
 */
const PADROES_DE_SONDAGEM = [
    // Qualquer coisa .php — o stack é Node, isto nunca é legítimo aqui.
    { nome: 'php', re: /\.php\d?(?:$|[/?#])/i },

    // WordPress: o alvo mais varrido da internet.
    { nome: 'wordpress', re: /^\/(?:wp-(?:admin|content|includes|login|json|config)|xmlrpc)/i },

    // Dotfiles: /.env, /.git/config, /.aws/credentials, /.ssh/id_rsa.
    // `.well-known/` fica de fora — é padrão legítimo (ACME, security.txt).
    { nome: 'dotfile', re: /^\/\.(?!well-known\/)/ },

    // Painéis e consoles de outros stacks.
    {
        nome: 'painel-de-terceiro',
        re: /^\/(?:vendor|cgi-bin|phpmyadmin|pma|myadmin|adminer|solr|jenkins|actuator|_ignition|telescope|_profiler|server-status|manager\/html|struts|owa|autodiscover)(?:$|[/?])/i,
    },

    // Extensões que este servidor nunca entrega (dump, backup, chave, binário).
    {
        nome: 'arquivo-sensivel',
        re: /\.(?:sql|bak|old|swp|swo|tar|tgz|gz|rar|7z|env|ini|conf|cfg|pem|key|p12|pfx|exe|dll|jar|war|asp|aspx|jsp|cgi|sh|bat|ps1)(?:$|[?#])/i,
    },
];

/** Padrões buscados na URL INTEIRA (caminho + query), não só no caminho. */
const PADROES_NA_URL = [
    {
        nome: 'travessia',
        re: /(?:\.\.[/\\]|\/etc\/passwd|\/proc\/self|\bwin\.ini\b|\bboot\.ini\b)/i,
    },
    { nome: 'injecao', re: /(?:\$\{jndi:|<\?php|<script|\bunion\s+select\b|\/bin\/(?:ba)?sh)/i },
];

/**
 * Caminhos-isca. Não existem, não são linkados de lugar nenhum e estão
 * anunciados como `Disallow` no robots.txt — ou seja, a ÚNICA forma de chegar
 * neles é ler o robots.txt procurando o que parece interessante, ou adivinhar
 * nome de painel. Crawler que respeita robots.txt não entra; gente também não.
 * Quem entra é bot, e o banimento é imediato, sem acumular pontos.
 */
const ARMADILHAS = new Set([
    '/painel-interno',
    '/admin-console',
    '/backup-sistema',
    '/config-sistema',
]);

/**
 * Ferramentas de ataque que se identificam no User-Agent.
 *
 * Confiar num header que o atacante controla parece ingênuo — e é, contra um
 * adversário dedicado. Mas a esmagadora maioria do tráfego hostil de fundo é
 * scanner rodando com o UA padrão, e derrubar isso na primeira requisição
 * limpa o log a ponto de o que sobra virar sinal legível.
 */
const UA_DE_ATAQUE =
    /(sqlmap|nikto|nmap|masscan|zgrab|nuclei|dirbuster|gobuster|feroxbuster|wpscan|hydra|havij|acunetix|netsparker|arachni|metasploit|commix|xsstrike|wfuzz|ffuf|zaproxy|openvas|nessus|whatweb|joomscan|sqlninja|dirsearch)/i;

/**
 * Scrapers comerciais de SEO/IA. Não são ataque — e é por isso que precisam de
 * regra própria: eles rastreiam o site inteiro, repetidamente, consumindo CPU
 * e banda de um plano free para alimentar produto de terceiro. O sistema é uma
 * ferramenta escolar fechada e não tem nada a ganhar com isso.
 *
 * Configurável por `EDGE_SCRAPERS_EXTRA` (adiciona) e `EDGE_SCRAPERS_LIBERAR`
 * (isenta pelo nome), porque a decisão aqui é de política, não de segurança.
 */
const UA_SCRAPER_PADRAO = [
    'ahrefsbot',
    'semrushbot',
    'mj12bot',
    'dotbot',
    'dataforseobot',
    'petalbot',
    'bytespider',
    'blexbot',
    'seokicks',
    'serpstatbot',
    'zoominfobot',
    'megaindex',
    'barkrowler',
    'imagesiftbot',
    'timpibot',
    'omgili',
];

function montarListaDeScrapers() {
    const liberados = new Set(listaEnv('EDGE_SCRAPERS_LIBERAR').map((nome) => nome.toLowerCase()));
    return [
        ...UA_SCRAPER_PADRAO,
        ...listaEnv('EDGE_SCRAPERS_EXTRA').map((nome) => nome.toLowerCase()),
    ].filter((nome) => !liberados.has(nome));
}

// Montada UMA vez: o ambiente não muda com o processo rodando, e esta lista é
// consultada em quase toda requisição do site — cada CSS, JS, fonte e imagem.
const SCRAPERS = montarListaDeScrapers();

/**
 * Agentes que DEVEM passar, mesmo parecendo bot.
 *
 * O item que mais importa aqui é o preview de link: a escola manda o endereço
 * do portal por WhatsApp e Telegram, e esses serviços buscam a página com UA
 * de robô para montar o card. Bloqueá-los quebraria um fluxo real de uso, com
 * um sintoma ("o link não abre direito no zap") que ninguém ligaria a um
 * filtro de segurança.
 */
const UA_SEMPRE_PERMITIDO =
    /(googlebot|bingbot|duckduckbot|applebot|yandexbot|facebookexternalhit|whatsapp|telegrambot|twitterbot|linkedinbot|slackbot|discordbot|skypeuripreview|redditbot|google-inspectiontool|chrome-lighthouse|uptimerobot|pingdom|render|betteruptime)/i;

/**
 * Classifica o CAMINHO da requisição.
 * @returns {null | {motivo: string, pontos: number, armadilha?: boolean}}
 */
function classificarCaminho(caminho, urlCompleta = caminho) {
    // O caminho chega percent-encoded. Um scanner esconde `../` como
    // `%2e%2e%2f`, então é preciso decidir sobre as DUAS formas.
    //
    // As barras repetidas também são colapsadas aqui. `//.env` não começa com
    // `/.` e escapava da regra de dotfile; na prática o redirect canônico (que
    // roda DEPOIS deste guarda) devolvia 308 sem servir nada, então não havia
    // vazamento — mas a sondagem passava sem pontuar, e o atacante ganhava
    // tentativas de graça. Colapsar aqui elimina a variante inteira, e é só
    // classificação: o roteamento continua sendo do Express.
    const normalizarBarras = (valor) => valor.replace(/\/{2,}/g, '/');
    const formas = new Set([normalizarBarras(caminho)]);
    try {
        formas.add(normalizarBarras(decodeURIComponent(caminho)));
    } catch {
        // `%ZZ` não decodifica. Navegador nenhum emite isso; ferramenta de fuzz
        // emite o tempo todo — e um decode que falha aqui é um decode que pode
        // ter sucesso em outra camada, que é como nasce bypass de filtro.
        return { motivo: 'url-malformada', pontos: PONTOS.urlMalformada };
    }

    for (const forma of formas) {
        const normalizado = (forma.replace(/\/+$/, '') || '/').toLowerCase();
        if (ARMADILHAS.has(normalizado)) {
            return { motivo: 'armadilha', pontos: PONTOS.sondagem, armadilha: true };
        }
    }

    // Travessia e injeção vêm ANTES das assinaturas de caminho, e a ordem é
    // pelo rótulo, não pela decisão: `/%2e%2e%2fetc%2fpasswd` decodifica para
    // `/../etc/passwd`, que casa com `dotfile` (começa com `/.`) antes de casar
    // com `travessia`. Bloquear, bloqueia dos dois jeitos — mas o log diria
    // "dotfile" para o que na verdade é tentativa de path traversal, e quem
    // estivesse investigando o incidente leria a classificação errada.
    const urls = new Set([urlCompleta]);
    try {
        urls.add(decodeURIComponent(urlCompleta));
    } catch {
        return { motivo: 'url-malformada', pontos: PONTOS.urlMalformada };
    }
    for (const url of urls) {
        for (const { nome, re } of PADROES_NA_URL) {
            if (re.test(url)) return { motivo: nome, pontos: PONTOS.sondagem };
        }
    }

    for (const forma of formas) {
        for (const { nome, re } of PADROES_DE_SONDAGEM) {
            if (re.test(forma)) return { motivo: nome, pontos: PONTOS.sondagem };
        }
    }

    return null;
}

/**
 * Classifica o User-Agent.
 * @returns {null | {motivo: string, pontos: number}}
 */
function classificarUserAgent(ua) {
    const texto = String(ua || '');

    // Ausência de UA NÃO bloqueia. Vale explicar por quê: é tentador tratar
    // como bot, mas service worker, health check e cliente de linha de comando
    // legítimo também chegam sem UA em alguns caminhos, e o custo de errar aqui
    // é o site simplesmente não abrir para alguém. Quem cobre esse caso é o
    // teto de taxa, que vale para todo mundo.
    if (!texto.trim()) return null;

    if (UA_SEMPRE_PERMITIDO.test(texto)) return null;
    if (UA_DE_ATAQUE.test(texto))
        return { motivo: 'ua-ferramenta-de-ataque', pontos: PONTOS.uaAtaque };

    const minusculo = texto.toLowerCase();
    for (const scraper of SCRAPERS) {
        if (minusculo.includes(scraper)) return { motivo: 'ua-scraper', pontos: PONTOS.uaScraper };
    }

    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// RESPOSTAS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Responde a um bloqueio pelo caminho mais barato possível.
 *
 * Sondagem recebe **404**, não 403. Um 403 confirma que existe um filtro e que
 * o caminho é interessante o bastante para ter regra; o 404 é indistinguível
 * de "não existe" e não ensina nada a quem está mapeando o servidor.
 *
 * Nunca usa `sendFile` — o 404 amigável do app lê disco, e um scanner faria
 * disso a própria alavanca de carga.
 */
function responderBloqueio(req, res, { status, mensagem, retryAfterSegundos }) {
    if (retryAfterSegundos) res.setHeader('Retry-After', String(retryAfterSegundos));
    res.setHeader('Cache-Control', 'no-store');
    if (req.path.startsWith('/api')) {
        return res.status(status).json({ success: false, error: mensagem });
    }
    return res.type('text/plain').status(status).send(mensagem);
}

/** Registra o bloqueio no log com IP hasheado (nunca em claro). */
function logarBloqueio(chave, motivo, req, extra = {}) {
    logger.warn('[EdgeGuard] requisicao bloqueada', {
        ipHash: hashDoIp(chave),
        motivo,
        metodo: req.method,
        // `req.path` pode conter dado colado pelo atacante; 120 chars bastam
        // para diagnosticar e evitam que o log vire o próprio vetor de custo.
        caminho: String(req.path || '').slice(0, 120),
        ...extra,
    });
}

/** Alerta de banimento novo — uma linha por banimento, não por requisição. */
function alertarBanimento(chave, motivo, resultado) {
    if (!resultado.novoBanimento) return;
    logger.alert('EDGE_IP_BANIDO', 'IP banido pela protecao de borda', {
        ipHash: hashDoIp(chave),
        motivo,
        minutos: Math.round(resultado.restanteMs / UM_MINUTO),
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// ISENÇÕES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * IPs isentos de TODA a camada de borda.
 *
 * Existe por um motivo concreto: a escola sai por NAT, então trinta máquinas
 * do laboratório chegam aqui como UM IP. A pontuação por janela já impede que
 * um pico de uso bana a escola, mas se a rede tem IP fixo, colocá-lo aqui
 * elimina também o 429 do teto de taxa em dia de pico.
 */
const IPS_ISENTOS = new Set(listaEnv('EDGE_ALLOWLIST_IPS'));

/**
 * Caminhos que nunca podem ser barrados.
 *
 * Health check barrado derruba o serviço: o Render marca a instância como
 * doente e para de rotear para ela. `/health` e `/ready` entram já agora
 * porque as sondas da Issue #335 vão morar fora de `/api` — sem isto, a
 * primeira vez que o IP do balanceador somasse pontos, a instância sairia do
 * ar por uma decisão desta camada.
 */
const CAMINHOS_ISENTOS = new Set([
    '/api/health',
    '/api/health/observability',
    '/health',
    '/ready',
    '/robots.txt',
]);

function isento(req) {
    if (IPS_ISENTOS.size > 0 && IPS_ISENTOS.has(chaveIp(req))) return true;
    return CAMINHOS_ISENTOS.has(req.path);
}

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ETAPA 1 — banimento. Monte como a PRIMEIRA linha do app, antes de compressão
 * e de logger: o objetivo é que o IP banido custe um lookup em Map e nada
 * mais. É esta etapa que faz o custo do ataque parar de crescer.
 */
function criarGuardaDeBanimento({ registro = registroPadrao, ativo = !isTest } = {}) {
    return function guardaDeBanimento(req, res, next) {
        if (!ativo || isento(req)) return next();

        const chave = chaveIp(req);
        const { banido, restanteMs } = registro.situacao(chave);
        if (!banido) return next();

        return responderBloqueio(req, res, {
            status: 429,
            mensagem: 'Acesso temporariamente bloqueado por excesso de requisicoes.',
            retryAfterSegundos: Math.ceil(restanteMs / UM_SEGUNDO),
        });
    };
}

/**
 * ETAPAS 2 a 5 — método, armadilha, sondagem e user-agent.
 *
 * Estes filtros são DETERMINÍSTICOS (não dependem de contador), então ficam
 * ligados também em teste: é o que permite verificá-los pelo app real. Não há
 * risco de uma suíte ser banida por acidente, porque a PONTUAÇÃO — essa sim
 * acumulativa — é que respeita `pontuar`.
 */
function criarGuardaDeFiltros({ registro = registroPadrao, pontuar = !isTest } = {}) {
    return function guardaDeFiltros(req, res, next) {
        if (isento(req)) return next();

        // A chave só é calculada quando algum filtro dispara. O caminho normal
        // — que é ~100% do tráfego real, e passa por aqui uma vez por CSS, JS,
        // fonte e imagem — não paga a normalização de IPv6 à toa.
        let chaveMemo = null;
        const obterChave = () => {
            if (chaveMemo === null) chaveMemo = chaveIp(req);
            return chaveMemo;
        };

        const punir = (motivo, pontos, { armadilha = false } = {}) => {
            if (!pontuar) return;
            const chave = obterChave();
            const resultado = armadilha
                ? registro.banirAgora(chave)
                : registro.registrar(chave, pontos);
            alertarBanimento(chave, motivo, resultado);
        };

        // ── método ──
        if (!METODOS_PERMITIDOS.has(req.method)) {
            punir('metodo-nao-permitido', PONTOS.metodo);
            logarBloqueio(obterChave(), 'metodo-nao-permitido', req);
            res.setHeader('Allow', [...METODOS_PERMITIDOS].join(', '));
            return responderBloqueio(req, res, { status: 405, mensagem: 'Metodo nao permitido.' });
        }

        // ── caminho (armadilha + sondagem) ──
        const veredictoCaminho = classificarCaminho(
            req.path || '/',
            req.originalUrl || req.url || '/'
        );
        if (veredictoCaminho) {
            punir(veredictoCaminho.motivo, veredictoCaminho.pontos, {
                armadilha: veredictoCaminho.armadilha,
            });
            logarBloqueio(obterChave(), veredictoCaminho.motivo, req);

            // Codificação quebrada (`%ZZ`) recebe 400, não o 404 opaco: é o
            // status correto para URL que não decodifica, e é o que qualquer
            // servidor responde — não revela filtro nenhum. Também é o que o
            // gate de páginas já respondia antes desta camada existir.
            if (veredictoCaminho.motivo === 'url-malformada') {
                return responderBloqueio(req, res, {
                    status: 400,
                    mensagem: 'Requisicao invalida.',
                });
            }
            return responderBloqueio(req, res, { status: 404, mensagem: 'Nao encontrado.' });
        }

        // ── user-agent ──
        const veredictoUa = classificarUserAgent(req.get ? req.get('user-agent') : null);
        if (veredictoUa) {
            punir(veredictoUa.motivo, veredictoUa.pontos);
            logarBloqueio(obterChave(), veredictoUa.motivo, req);
            return responderBloqueio(req, res, { status: 403, mensagem: 'Acesso negado.' });
        }

        return next();
    };
}

/**
 * Identificador da janela corrente de um limitador, para a pontuação por
 * janela. O `MemoryStore` do express-rate-limit usa janela fixa por chave, e o
 * `resetTime` é o mesmo para todas as requisições dela — é o identificador
 * natural. Sem ele (store que não informa), cai na divisão inteira do relógio.
 */
function idDaJanela(req, windowMs) {
    const reset = req.rateLimit?.resetTime;
    if (reset instanceof Date) return String(reset.getTime());
    return String(Math.floor(Date.now() / windowMs));
}

/**
 * ETAPA 6 — teto de taxa em TODAS as rotas.
 *
 * Duas janelas, porque pegam coisas diferentes: a de RAJADA corta o flood
 * curto (que é o que derruba o processo), e a SUSTENTADA corta a varredura
 * lenta e paciente, que passa despercebida por qualquer teto curto.
 *
 * Os números são folgados de propósito. Uma primeira visita a uma página deste
 * frontend puxa dezenas de arquivos (o painel, ~74) e a escola inteira
 * compartilha um IP — o teto está aqui para impedir MILHARES de requisições
 * por minuto, não para policiar uso normal. E estourar não bane sozinho: cada
 * JANELA estourada soma 4 pontos, uma vez só (ver `registrarEstouroDeTaxa`).
 *
 * `rajada` e `sustentado` são injetáveis para o teste exercitar várias janelas
 * em segundos, em vez de esperar minutos de relógio.
 */
function criarLimitesDeBorda({
    registro = registroPadrao,
    ativo = !isTest,
    rajada = {
        windowMs: 10 * UM_SEGUNDO,
        max: isProduction ? numeroEnv('EDGE_RAJADA_MAX', 240) : 2400,
    },
    sustentado = {
        windowMs: 5 * UM_MINUTO,
        max: isProduction ? numeroEnv('EDGE_SUSTENTADO_MAX', 1500) : 15000,
    },
} = {}) {
    const contabilizar = (motivo) => (req, res, _next, opcoes) => {
        const chave = chaveIp(req);
        const resultado = registro.registrarEstouroDeTaxa(
            chave,
            motivo,
            idDaJanela(req, opcoes.windowMs)
        );
        alertarBanimento(chave, motivo, resultado);

        // Log só no primeiro estouro da janela: o resto da rajada é a mesma
        // informação repetida, e o log não pode virar o próprio custo do flood.
        if (!resultado.jaPontuada) logarBloqueio(chave, motivo, req);

        const reset = req.rateLimit?.resetTime;
        const restanteMs = reset instanceof Date ? reset.getTime() - Date.now() : opcoes.windowMs;
        return responderBloqueio(req, res, {
            status: opcoes.statusCode,
            mensagem: 'Muitas requisicoes. Aguarde um momento e tente novamente.',
            retryAfterSegundos: Math.max(1, Math.ceil(restanteMs / UM_SEGUNDO)),
        });
    };

    const comum = {
        keyGenerator: (req) => `borda:${chaveIp(req)}`,
        skip: (req) => !ativo || isento(req),
        standardHeaders: true,
        legacyHeaders: false,
    };

    const limiteDeRajada = rateLimit({
        ...comum,
        windowMs: rajada.windowMs,
        max: rajada.max,
        handler: contabilizar('taxa-rajada'),
    });

    const limiteSustentado = rateLimit({
        ...comum,
        windowMs: sustentado.windowMs,
        max: sustentado.max,
        handler: contabilizar('taxa-sustentada'),
    });

    return [limiteDeRajada, limiteSustentado];
}

module.exports = {
    criarGuardaDeBanimento,
    criarGuardaDeFiltros,
    criarLimitesDeBorda,

    // Exportados para teste e diagnóstico
    criarRegistro,
    classificarCaminho,
    classificarUserAgent,
    hashDoIp,
    ARMADILHAS,
    PONTOS,
};
