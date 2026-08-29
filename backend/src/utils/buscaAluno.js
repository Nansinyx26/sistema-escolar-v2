/**
 * buscaAluno.js — filtros de busca de aluno compartilhados pela Secretaria.
 *
 * POR QUE UM MÓDULO SÓ
 * --------------------
 * A busca de aluno estava escrita três vezes, cada uma com um recorte
 * diferente do mesmo problema:
 *
 *   - `/api/alunos?q=`                → regex em `nome` e `matricula`
 *   - `/api/alunos/codigos-secretos`  → regex em `nome`, `matricula` e código
 *   - `/api/secretaria/alunos/buscar` → só `nomeNormalizado`
 *
 * As três falhavam do mesmo jeito na prática da secretaria: procurar "joao"
 * não achava "João", procurar "silva joao" não achava "João da Silva" (a regex
 * exige a ordem exata), e nenhuma delas olhava para `sobrenome` — que é onde
 * metade do nome do aluno mora depois da importação da SEDUC. O resultado é
 * uma tela que jura não ter o aluno que está cadastrado.
 *
 * Aqui a busca é: sem acento, multi-termo (cada palavra pode casar em um campo
 * diferente, em qualquer ordem) e cobrindo nome, sobrenome, RA, sala e — quando
 * o chamador autoriza — o código secreto.
 *
 * SEGURANÇA (ReDoS): todo termo passa por `escapeRegex` e as classes geradas
 * aqui não têm quantificador aninhado, então o casamento é linear no tamanho da
 * entrada. O número de termos e o tamanho de cada um também têm teto.
 */
const escapeRegex = require('./escapeRegex');
const { colapsarEspacos, removerAcentos } = require('./nomeAluno');

/** Termos além disto são ignorados: ninguém digita 7 palavras para achar um aluno. */
const MAX_TERMOS = 6;
/** Um termo maior que isto é truncado antes de virar regex. */
const MAX_TAMANHO_TERMO = 60;

/**
 * Classes de equivalência sem acento. A busca precisa funcionar nos dois
 * sentidos: quem digita "joao" tem que achar "João", e quem digita "joão"
 * tem que achar um cadastro legado gravado como "JOAO".
 */
const EQUIVALENTES = {
    a: 'aàáâãäå',
    c: 'cç',
    e: 'eèéêë',
    i: 'iìíîï',
    n: 'nñ',
    o: 'oòóôõö',
    u: 'uùúûü',
    y: 'yýÿ',
};

/**
 * Converte um texto em uma regex que ignora acento.
 * O texto é escapado ANTES da expansão; `escapeRegex` só insere `\` na frente
 * de caractere não-alfabético, então trocar letras depois nunca quebra uma
 * sequência de escape.
 *
 * @param {string} texto
 * @returns {string} fonte da regex (sem âncoras)
 */
function fonteSemAcento(texto) {
    const base = removerAcentos(colapsarEspacos(texto)).toLowerCase().slice(0, MAX_TAMANHO_TERMO);
    return escapeRegex(base).replace(/[a-z]/g, (letra) => {
        const classe = EQUIVALENTES[letra];
        return classe ? `[${classe}]` : letra;
    });
}

/** Quebra o texto em termos úteis (descarta vazios e respeita o teto). */
function termosDe(texto) {
    return colapsarEspacos(texto).split(' ').filter(Boolean).slice(0, MAX_TERMOS);
}

// ─── Sala (turma) ────────────────────────────────────────────────────────────

/**
 * Forma canônica de uma sala: sem acento, sem ordinal, sem espaço, maiúscula.
 * "1º A", "1ºA", "1 a" e "1A" viram todos "1A".
 */
function normalizarSala(sala) {
    return removerAcentos(String(sala == null ? '' : sala))
        .replace(/[º°ª.\-_/\s]/g, '')
        .toUpperCase();
}

/**
 * Regex que casa uma sala em qualquer das grafias usadas na base.
 *
 * O mesmo 1º ano A aparece como "1A", "1ºA", "1º A" e "1 A" dependendo de quem
 * cadastrou — professora pelo app, secretaria pelo painel, ou a importação do
 * PDF da SEDUC. Comparar string com string (o `$in` de variações que existia
 * antes) só acerta quando a grafia é uma das que alguém lembrou de listar.
 *
 * @returns {string|null} fonte da regex ancorada, ou null se a sala for vazia
 */
function fonteDeSala(sala) {
    const canonica = normalizarSala(sala);
    if (!canonica) return null;
    // Entre um caractere e o próximo pode haver ordinal, espaço, ponto ou hífen.
    const separador = '[\\s.º°ª\\-_/]*';
    const corpo = canonica.split('').map(escapeRegex).join(separador);
    return `^${separador}${corpo}${separador}$`;
}

/**
 * Filtro Mongo de sala, cobrindo `turma` e `turmaId`.
 *
 * Suporta o prefixo `SERIE_` (usado pelo painel da direção para pedir "todo o
 * 1º ano") e aceita ids equivalentes — quando o chamador já resolveu quais
 * documentos `Turma` correspondem à sala, os `_id` deles entram no filtro para
 * alcançar também os alunos cujo vínculo foi gravado por ObjectId.
 *
 * @param {string} sala
 * @param {{idsEquivalentes?: string[]}} [opcoes]
 * @returns {object|null} condição para `$and`, ou null quando não há filtro
 */
function filtroDeSala(sala, opcoes = {}) {
    const bruto = colapsarEspacos(sala);
    if (!bruto) return null;

    const condicoes = [];

    if (bruto.startsWith('SERIE_')) {
        // "todo o 1º ano": casa qualquer sala que COMECE com a série.
        const serie = normalizarSala(bruto.slice('SERIE_'.length));
        if (!serie) return null;
        const prefixo = `^[\\s.º°ª\\-_/]*${serie.split('').map(escapeRegex).join('[\\s.º°ª\\-_/]*')}`;
        condicoes.push(
            { turma: { $regex: prefixo, $options: 'i' } },
            { turmaId: { $regex: prefixo, $options: 'i' } }
        );
    } else {
        const fonte = fonteDeSala(bruto);
        if (!fonte) return null;
        condicoes.push(
            { turma: { $regex: fonte, $options: 'i' } },
            { turmaId: { $regex: fonte, $options: 'i' } }
        );
    }

    const ids = (opcoes.idsEquivalentes || []).map(String).filter(Boolean);
    if (ids.length) {
        condicoes.push({ turmaId: { $in: ids } }, { turma: { $in: ids } });
    }

    return { $or: condicoes };
}

/**
 * O termo digitado tem cara de sala? ("1A", "3ºB", "2", "C")
 * Nome de aluno nunca tem dígito, e sala é sempre curta.
 */
function pareceSala(termo) {
    const canonica = normalizarSala(termo);
    if (!canonica || canonica.length > 4) return false;
    return /\d/.test(canonica) || canonica.length <= 2;
}

/** A sala do aluno é a mesma sala pedida? (versão em memória de `filtroDeSala`) */
function salaCasa(valorDoAluno, salaPedida) {
    const alvo = normalizarSala(salaPedida);
    if (!alvo) return true;
    return normalizarSala(valorDoAluno) === alvo;
}

// ─── Nome / RA / código ──────────────────────────────────────────────────────

/**
 * Filtro Mongo de busca livre por aluno.
 *
 * Cada termo digitado precisa casar em ALGUM campo (`$and` de `$or`), o que faz
 * "silva joao" achar "João da Silva" — o comportamento que a secretaria espera
 * e que a regex única não dava.
 *
 * @param {string} texto termo digitado
 * @param {{incluirCodigo?: boolean, incluirSala?: boolean}} [opcoes]
 * @returns {object|null} condição para `$and`, ou null quando não há termo
 */
function filtroDeBusca(texto, opcoes = {}) {
    const termos = termosDe(texto);
    if (!termos.length) return null;

    const { incluirCodigo = false, incluirSala = true } = opcoes;

    const porTermo = termos.map((termo) => {
        const fonte = fonteSemAcento(termo);
        const alternativas = [
            // `nomeNormalizado` é a chave indexada ({escolaId, nomeNormalizado});
            // ela já está sem acento, então basta a fonte crua.
            { nomeNormalizado: { $regex: fonte } },
            // Cadastros antigos (e os gravados por bulkWrite) podem não ter
            // `nomeNormalizado`. Sem estes dois, o aluno some da busca.
            { nome: { $regex: fonte, $options: 'i' } },
            { sobrenome: { $regex: fonte, $options: 'i' } },
            { matricula: { $regex: fonte, $options: 'i' } },
        ];

        // Sala só entra quando o termo TEM CARA de sala ("1A", "2", "B"). Sem
        // essa peneira, cada palavra do nome gera uma regex ancorada inútil
        // sobre `turma`/`turmaId` — custo por documento, zero resultado.
        if (incluirSala && pareceSala(termo)) {
            const fonteSala = fonteDeSala(termo);
            if (fonteSala) {
                alternativas.push(
                    { turma: { $regex: fonteSala, $options: 'i' } },
                    { turmaId: { $regex: fonteSala, $options: 'i' } }
                );
            }
        }

        if (incluirCodigo) {
            alternativas.push({ codigoSecreto: { $regex: fonte, $options: 'i' } });
        }

        return { $or: alternativas };
    });

    return porTermo.length === 1 ? porTermo[0] : { $and: porTermo };
}

// ─── Composição ──────────────────────────────────────────────────────────────

/**
 * Junta condições em um filtro, sem o vaivém de `$or`/`$and` que estava copiado
 * em três controllers (e que já tinha errado ao sobrescrever um `$or` existente).
 * Tudo que vem depois do filtro base entra em `$and`, então nenhuma condição
 * anterior é perdida.
 *
 * @param {object} base filtro inicial (escola, ativo, ...)
 * @param {...(object|null|undefined)} condicoes
 * @returns {object} filtro Mongo
 */
function combinar(base, ...condicoes) {
    const extras = condicoes.filter(Boolean);
    if (!extras.length) return { ...base };

    const filtro = { ...base };
    const acumulado = Array.isArray(filtro.$and) ? [...filtro.$and] : [];

    // Um `$or` que já esteja na base vira mais um item do `$and` — somar um
    // segundo `$or` por cima do primeiro apagaria silenciosamente o filtro anterior.
    if (filtro.$or) {
        acumulado.push({ $or: filtro.$or });
        delete filtro.$or;
    }

    filtro.$and = acumulado.concat(extras);
    return filtro;
}

module.exports = {
    combinar,
    filtroDeBusca,
    filtroDeSala,
    fonteDeSala,
    fonteSemAcento,
    normalizarSala,
    pareceSala,
    salaCasa,
    termosDe,
};
