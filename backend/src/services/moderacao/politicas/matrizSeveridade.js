/**
 * matrizSeveridade.js — §5.1 da ESPEC-MODERACAO-CHAT.md.
 *
 * Este arquivo é a POLÍTICA, separada dos adaptadores de propósito: trocar o
 * provedor de imagem ou de classificação de texto não pode mexer em como a
 * escola decide o que é grave. E política que não é testável isoladamente vira
 * política que ninguém ajusta com confiança.
 *
 * Severidade final = a MAIOR entre as camadas (léxico, classificador, imagem).
 * Nenhuma camada abaixa o que outra levantou.
 */

/** Ordem canônica — o índice é o que permite comparar "maior que". */
const ESCALA = ['nenhuma', 'leve', 'moderada', 'grave', 'critica'];

/**
 * O léxico fala em masculino ('moderado') e a escala da moderação em feminino
 * ('moderada'), porque uma qualifica o NÍVEL e a outra a SEVERIDADE. Traduzir
 * num ponto só evita a comparação silenciosamente falsa `'moderado' ===
 * 'moderada'`, que devolveria `false` e rebaixaria a decisão sem erro nenhum.
 */
const NIVEL_LEXICO_PARA_SEVERIDADE = {
    leve: 'leve',
    moderado: 'moderada',
    grave: 'grave',
};

/** Ações por severidade — a tabela de §5.1, em dados. */
const ACAO_POR_SEVERIDADE = {
    critica: {
        decisao: 'bloqueada',
        entrega: false,
        fila: true,
        prioridade: 'maxima',
        escalonar: true,
    },
    grave: {
        decisao: 'bloqueada',
        entrega: false,
        fila: true,
        prioridade: 'normal',
        escalonar: false,
    },
    moderada: {
        decisao: 'em_revisao',
        entrega: false,
        fila: true,
        prioridade: 'normal',
        escalonar: false,
    },
    leve: {
        decisao: 'entregue_com_registro',
        entrega: true,
        fila: false,
        prioridade: 'normal',
        escalonar: false,
    },
    nenhuma: { decisao: null, entrega: true, fila: false, prioridade: 'normal', escalonar: false },
};

/** Perfis que recebem a atenuação do eixo `medical` (§5.1). */
const PERFIS_ATENUADOS = new Set(['diretor', 'coordenacao', 'secretaria']);

/**
 * Aceita tanto a escala de severidade quanto o vocabulário do léxico.
 *
 * Sem isto, quem chamasse `decidir({ severidadeLexico: 'moderado' })` — que é
 * literalmente o que o filtro devolve em `resultado.nivel` — receberia
 * `'nenhuma'`, porque `'moderado'` não está na ESCALA. Nenhum erro, nenhum
 * aviso: a mensagem simplesmente deixaria de ser moderada. É a armadilha que o
 * comentário de `NIVEL_LEXICO_PARA_SEVERIDADE` descreve, e o único jeito de ela
 * não morder é a função se defender da entrada em vez de confiar em quem chama.
 */
function normalizar(valor) {
    const texto = String(valor || 'nenhuma').toLowerCase();
    if (ESCALA.includes(texto)) return texto;
    return NIVEL_LEXICO_PARA_SEVERIDADE[texto] || 'nenhuma';
}

function indice(severidade) {
    const i = ESCALA.indexOf(normalizar(severidade));
    return i < 0 ? 0 : i;
}

/** A maior severidade entre as informadas. */
function maiorSeveridade(...valores) {
    return valores.reduce(
        (maior, atual) => (indice(atual) > indice(maior) ? normalizar(atual) : maior),
        'nenhuma'
    );
}

function severidadeDoLexico(nivel) {
    return NIVEL_LEXICO_PARA_SEVERIDADE[String(nivel || '').toLowerCase()] || 'nenhuma';
}

/**
 * Decide o desfecho de uma análise.
 *
 * @param {Object} entrada
 * @param {string} [entrada.severidadeLexico]        Severidade vinda da Camada 1.
 * @param {string} [entrada.severidadeClassificador] Camada 2 (Fase 4).
 * @param {string} [entrada.severidadeImagem]        Análise de imagem (Fases 1–2).
 * @param {Object} [entrada.categorias]              Escores por eixo.
 * @param {string} [entrada.perfilRemetente]
 * @param {boolean} [entrada.reincidente]            3+ ocorrências em 30 dias (§5.1).
 * @param {boolean} [entrada.confirmadoPeloLexico]   Classificador `grave` confirmado pela Camada 1.
 * @returns {{severidade:string, decisao:string|null, entrega:boolean, fila:boolean,
 *            prioridade:string, escalonar:boolean, atenuada:boolean, agravada:boolean}}
 */
function decidir(entrada = {}) {
    const {
        severidadeLexico = 'nenhuma',
        severidadeClassificador = 'nenhuma',
        severidadeImagem = 'nenhuma',
        categorias = {},
        perfilRemetente = '',
        reincidente = false,
        confirmadoPeloLexico = false,
    } = entrada;

    // Classificador `grave` SEM confirmação da Camada 1 não bloqueia sozinho:
    // vira MODERADA (retenção + revisão humana). É a linha da tabela que impede
    // um falso positivo do modelo de barrar mensagem de pai sem ninguém olhar.
    let doClassificador = normalizar(severidadeClassificador);
    if (doClassificador === 'grave' && !confirmadoPeloLexico) {
        doClassificador = 'moderada';
    }

    let severidade = maiorSeveridade(severidadeLexico, doClassificador, severidadeImagem);

    // ── Agravamento por reincidência ──────────────────────────────────────
    // 3 ocorrências LEVE+ em 30 dias ⇒ a próxima LEVE é tratada como MODERADA.
    // Só sobe de LEVE: reincidência não transforma MODERADA em GRAVE, senão o
    // histórico viraria pena crescente automática sem decisão humana nenhuma.
    let agravada = false;
    if (reincidente && severidade === 'leve') {
        severidade = 'moderada';
        agravada = true;
    }

    // ── Atenuação por perfil no eixo `medical` ────────────────────────────
    // O caso real: a secretaria fotografa um atestado com ferimento e o eixo
    // `medical` sobe. Reter isso é atrapalhar o trabalho da escola por uma foto
    // legítima. Só vale para MODERADA, só para esses perfis, e só quando
    // `medical` é o eixo DOMINANTE — se `adult` ou `violence` estiverem em jogo,
    // a atenuação não se aplica.
    let atenuada = false;
    if (
        severidade === 'moderada' &&
        PERFIS_ATENUADOS.has(String(perfilRemetente || '').toLowerCase()) &&
        eixoDominanteEhMedical(categorias)
    ) {
        severidade = 'leve';
        atenuada = true;
    }

    return { severidade, ...ACAO_POR_SEVERIDADE[severidade], atenuada, agravada };
}

/**
 * `medical` é o maior escore E os eixos que nunca são atenuados estão baixos.
 * Sem a segunda condição, uma imagem com `adult` alto e `medical` só um pouco
 * mais alto escaparia pela porta do atestado.
 */
function eixoDominanteEhMedical(categorias = {}) {
    const medical = Number(categorias.medical || 0);
    if (medical <= 0) return false;

    const adult = Number(categorias.adult || 0);
    const violence = Number(categorias.violence || 0);
    if (adult >= medical || violence >= medical) return false;

    const outros = Object.entries(categorias)
        .filter(([eixo]) => eixo !== 'medical')
        .map(([, valor]) => Number(valor || 0));

    return outros.every((valor) => valor < medical);
}

module.exports = {
    ESCALA,
    normalizar,
    ACAO_POR_SEVERIDADE,
    PERFIS_ATENUADOS,
    NIVEL_LEXICO_PARA_SEVERIDADE,
    decidir,
    maiorSeveridade,
    severidadeDoLexico,
    eixoDominanteEhMedical,
};
