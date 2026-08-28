/**
 * lexicoAdapter.js — Camada 1 vestida com a interface comum dos adaptadores.
 *
 * Todo adaptador expõe `analisar(entrada) → veredito normalizado`, para que
 * trocar de provedor não toque a política de decisão (§8.1). Este aqui não fala
 * com provedor nenhum: embrulha o `filtroPalavroes` que já roda in-process,
 * com latência e custo zero.
 *
 * É o único adaptador ligado na Fase 0 — e o motivo de a Fase 0 já produzir
 * ocorrências reais no painel sem nenhuma chave de API configurada.
 */

const filtroPalavroes = require('../../../utils/filtroPalavroes');
const { severidadeDoLexico } = require('../politicas/matrizSeveridade');

const NOME = 'lexico';

/**
 * @param {string} texto
 * @returns {{severidade:string, categorias:Object, termos:string[], trechos:string[],
 *            provedor:string, latenciaMs:number, bloqueiaNaCamada1:boolean}}
 */
function analisar(texto) {
    const inicio = Date.now();

    if (typeof texto !== 'string' || texto.trim() === '') {
        return vazio(inicio);
    }

    let resultado;
    try {
        resultado = filtroPalavroes.analisar(texto);
    } catch {
        // Fail-open, igual ao middleware: um defeito no filtro não pode derrubar
        // a análise inteira. Quem chama trata `severidade: 'nenhuma'` como
        // "nada a registrar", e o chat segue funcionando.
        return vazio(inicio);
    }

    return {
        severidade: severidadeDoLexico(resultado.nivel),
        // O léxico não pontua eixos — ele acende ou não acende. Devolver o mapa
        // vazio mantém o contrato igual ao dos adaptadores que pontuam.
        categorias: {},
        termos: Array.isArray(resultado.termos) ? resultado.termos : [],
        trechos: Array.isArray(resultado.ocorrencias)
            ? resultado.ocorrencias.map((o) => o.trecho)
            : [],
        provedor: NOME,
        latenciaMs: Date.now() - inicio,
        // `bloquear` é a decisão do filtro segundo FILTRO_PALAVROES_NIVEIS —
        // que é configurável por ambiente e NÃO é a mesma coisa que a
        // severidade. Uma escola pode bloquear só `grave` e ainda assim querer
        // a ocorrência `leve` registrada no painel.
        bloqueiaNaCamada1: Boolean(resultado.bloquear),
    };
}

function vazio(inicio) {
    return {
        severidade: 'nenhuma',
        categorias: {},
        termos: [],
        trechos: [],
        provedor: NOME,
        latenciaMs: Date.now() - inicio,
        bloqueiaNaCamada1: false,
    };
}

module.exports = { nome: NOME, analisar };
