/**
 * config/rateLimit.js — tetos, janelas e bloqueio progressivo, lidos do ambiente.
 *
 * Toda variável tem padrão seguro: sem nada definido, o sistema aplica os
 * valores abaixo. Valor inválido não derruba o boot nem afrouxa o limite: volta
 * para o padrão e deixa um aviso no log. Afrouxar um teto é decisão de
 * operação, registrada no ambiente, não edição de código.
 *
 * Detalhes e exemplos em docs/RATE-LIMIT.md.
 */
const logger = require('../utils/logger');
const { criarListaIps } = require('../utils/ipCliente');

const UNIDADES_MS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };

const avisosDados = new Set();
function avisar(mensagem) {
    if (avisosDados.has(mensagem)) return;
    avisosDados.add(mensagem);
    logger.warn(`[rate-limit] ${mensagem}`, { action: 'ratelimit.configuracaoInvalida' });
}

/**
 * Converte "30s", "15m", "1h" ou "2d" em milissegundos.
 * Número sem unidade é recusado: "15" poderia ser lido como 15 segundos numa
 * janela que deveria ser de 15 minutos, e o erro afrouxaria o limite calado.
 */
function lerDuracao(bruto, padraoMs, nome) {
    if (bruto === undefined || bruto === null || String(bruto).trim() === '') return padraoMs;
    const casou = /^(\d+)\s*([smhd])$/i.exec(String(bruto).trim());
    if (!casou || Number(casou[1]) <= 0) {
        avisar(`${nome}="${bruto}" inválido (use 30s, 15m, 1h ou 2d). Usando o padrão.`);
        return padraoMs;
    }
    return Number(casou[1]) * UNIDADES_MS[casou[2].toLowerCase()];
}

function lerInteiro(bruto, padrao, nome) {
    if (bruto === undefined || bruto === null || String(bruto).trim() === '') return padrao;
    const valor = Number(String(bruto).trim());
    if (!Number.isInteger(valor) || valor <= 0) {
        avisar(`${nome}="${bruto}" inválido (use um inteiro positivo). Usando ${padrao}.`);
        return padrao;
    }
    return valor;
}

/**
 * Onde os contadores ficam. `mongo` é o padrão fora de teste: o mesmo banco
 * que o sistema já usa, compartilhado entre instâncias e sem custo extra.
 * `memoria` serve para desenvolvimento offline ou para desligar o banco do
 * caminho em caso de emergência.
 */
function tipoDeArmazenamento(env = process.env) {
    const valor = String(env.RATE_LIMIT_STORE || '')
        .trim()
        .toLowerCase();
    if (valor === 'memoria' || valor === 'memory') return 'memoria';
    if (valor === 'mongo') return 'mongo';
    if (valor) avisar(`RATE_LIMIT_STORE="${env.RATE_LIMIT_STORE}" inválido (mongo | memoria).`);
    return env.NODE_ENV === 'test' ? 'memoria' : 'mongo';
}

/**
 * Teto geral de /api. Quem não está autenticado conta pelo IP; quem está,
 * pela conta. A escola inteira costuma sair por um IP só, e contar professor
 * autenticado pelo IP colocaria a sala dos professores toda num mesmo teto.
 */
function configuracaoGlobal(env = process.env) {
    const producao = env.NODE_ENV === 'production';
    return {
        janelaMs: lerDuracao(env.RATE_LIMIT_GLOBAL_JANELA, 60 * 1000, 'RATE_LIMIT_GLOBAL_JANELA'),
        maxIp: lerInteiro(env.RATE_LIMIT_GLOBAL_IP, producao ? 100 : 1000, 'RATE_LIMIT_GLOBAL_IP'),
        // Uma tela do painel dispara várias chamadas ao abrir; 200/min cobre
        // quem navega rápido entre telas sem abrir espaço para laço de script.
        maxUsuario: lerInteiro(
            env.RATE_LIMIT_GLOBAL_USUARIO,
            producao ? 200 : 2000,
            'RATE_LIMIT_GLOBAL_USUARIO'
        ),
    };
}

/**
 * Proteção do POST /api/auth/login por IP, contando só a tentativa que falha.
 *
 * Bloqueio progressivo: base × 2^(reincidência − 1), limitado ao teto.
 * Com os padrões: 15 min → 30 min → 1 h → 2 h → … → 24 h.
 * A reincidência é esquecida quando o último bloqueio terminou há mais tempo
 * que `memoriaMs`: um engano de meses atrás não pesa no de hoje.
 */
function configuracaoLogin(env = process.env) {
    const listaLivre = criarListaIps(env.RATE_LIMIT_IPS_LIVRES);
    if (listaLivre.invalidos.length > 0) {
        avisar(
            `RATE_LIMIT_IPS_LIVRES ignorou entradas inválidas: ${listaLivre.invalidos.join(', ')}`
        );
    }
    const bloqueioBaseMs = lerDuracao(
        env.RATE_LIMIT_LOGIN_BLOQUEIO,
        15 * 60 * 1000,
        'RATE_LIMIT_LOGIN_BLOQUEIO'
    );
    let bloqueioMaxMs = lerDuracao(
        env.RATE_LIMIT_LOGIN_BLOQUEIO_MAX,
        24 * 60 * 60 * 1000,
        'RATE_LIMIT_LOGIN_BLOQUEIO_MAX'
    );
    if (bloqueioMaxMs < bloqueioBaseMs) {
        avisar('RATE_LIMIT_LOGIN_BLOQUEIO_MAX menor que o bloqueio base. Usando o bloqueio base.');
        bloqueioMaxMs = bloqueioBaseMs;
    }
    return {
        maxFalhas: lerInteiro(env.RATE_LIMIT_LOGIN_FALHAS, 5, 'RATE_LIMIT_LOGIN_FALHAS'),
        janelaMs: lerDuracao(
            env.RATE_LIMIT_LOGIN_JANELA,
            15 * 60 * 1000,
            'RATE_LIMIT_LOGIN_JANELA'
        ),
        bloqueioBaseMs,
        bloqueioMaxMs,
        memoriaMs: lerDuracao(
            env.RATE_LIMIT_LOGIN_MEMORIA,
            24 * 60 * 60 * 1000,
            'RATE_LIMIT_LOGIN_MEMORIA'
        ),
        ipsLivres: listaLivre,
    };
}

const CHAVES_VALIDAS = new Set(['ip', 'usuario', 'usuario-ou-ip']);
const METODOS_VALIDOS = new Set(['*', 'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Regras por endpoint, sem editar código:
 *
 *   RATE_LIMIT_ROTAS='[{"rota":"POST /api/relatorios","limite":10,"janela":"1m","chave":"usuario"}]'
 *
 * `rota` é "MÉTODO /caminho" (ou só "/caminho" para qualquer método) e casa o
 * caminho e tudo abaixo dele. `chave`: ip | usuario | usuario-ou-ip (padrão).
 * Cada regra tem contador próprio; a regra vale somada ao teto global.
 */
function regrasPorRota(env = process.env) {
    const bruto = String(env.RATE_LIMIT_ROTAS || '').trim();
    if (!bruto) return [];
    let lista;
    try {
        lista = JSON.parse(bruto);
    } catch {
        avisar('RATE_LIMIT_ROTAS não é JSON válido. Nenhuma regra por endpoint aplicada.');
        return [];
    }
    if (!Array.isArray(lista)) {
        avisar('RATE_LIMIT_ROTAS precisa ser uma lista JSON. Nenhuma regra por endpoint aplicada.');
        return [];
    }

    const regras = [];
    lista.forEach((item, indice) => {
        const rotulo = `RATE_LIMIT_ROTAS[${indice}]`;
        if (!item || typeof item !== 'object' || typeof item.rota !== 'string') {
            avisar(`${rotulo} sem "rota". Regra ignorada.`);
            return;
        }
        const partes = item.rota.trim().split(/\s+/);
        const [metodo, caminho] = partes.length === 2 ? partes : ['*', partes[0]];
        const metodoMaiusculo = metodo.toUpperCase();
        if (!METODOS_VALIDOS.has(metodoMaiusculo) || !caminho?.startsWith('/api/')) {
            avisar(
                `${rotulo} com rota "${item.rota}" inválida (use "POST /api/..."). Regra ignorada.`
            );
            return;
        }
        if (!Number.isInteger(item.limite) || item.limite <= 0) {
            avisar(`${rotulo} com "limite" inválido. Regra ignorada.`);
            return;
        }
        const chave = item.chave || 'usuario-ou-ip';
        if (!CHAVES_VALIDAS.has(chave)) {
            avisar(
                `${rotulo} com "chave" inválida (ip | usuario | usuario-ou-ip). Regra ignorada.`
            );
            return;
        }
        regras.push({
            nome: `${metodoMaiusculo} ${caminho}`,
            metodo: metodoMaiusculo,
            caminho: caminho.replace(/\/+$/, ''),
            limite: item.limite,
            janelaMs: lerDuracao(item.janela, 60 * 1000, `${rotulo}.janela`),
            chave,
        });
    });
    return regras;
}

module.exports = {
    lerDuracao,
    tipoDeArmazenamento,
    configuracaoGlobal,
    configuracaoLogin,
    regrasPorRota,
};
