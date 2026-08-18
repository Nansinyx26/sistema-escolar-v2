/**
 * normalizacao.js — funções PURAS de normalização/validação dos dados de aluno.
 *
 * Nenhuma dependência de Express, Mongoose ou I/O. Recebe valor, devolve valor.
 * É a camada compartilhada entre o cadastro individual (Fluxo A) e a importação
 * em lote (Fluxo B), para que os dois gravem exatamente o mesmo formato.
 *
 * LGPD: este módulo NUNCA loga. Ele manipula nome, RA e data de nascimento —
 * o conjunto mais sensível do sistema. Quem chama é que decide o que registrar,
 * e a regra do projeto é registrar índice e contador, nunca conteúdo.
 */

// ─── Texto ───────────────────────────────────────────────────────────────────
// `colapsarEspacos`, `removerAcentos`, `normalizarNome` e `tituloCase` moram em
// `utils/nomeAluno` porque o pre-save do model `Aluno` também precisa deles, e
// o contrato de arquitetura proíbe `models/` de importar `services/`.
const {
    colapsarEspacos,
    removerAcentos,
    normalizarNome,
    tituloCase,
} = require('../../utils/nomeAluno');

/**
 * Valida o nome do aluno.
 * Regras do §4: mínimo 3 caracteres, pelo menos um espaço (nome + sobrenome),
 * não pode ser só números.
 */
function validarNome(nome) {
    const limpo = colapsarEspacos(nome);
    if (!limpo) return { ok: false, motivo: 'Nome é obrigatório.' };
    if (limpo.length < 3) return { ok: false, motivo: 'Nome muito curto (mínimo 3 caracteres).' };
    if (!/\p{L}/u.test(limpo)) return { ok: false, motivo: 'Nome não pode conter apenas números.' };
    if (!limpo.includes(' ')) return { ok: false, motivo: 'Informe nome e sobrenome.' };
    return { ok: true, valor: limpo };
}

// ─── RA (Registro Acadêmico) ─────────────────────────────────────────────────

/**
 * Extrai os dígitos do RA. Aceita colado com pontos/traços/espaços.
 *
 * SEMPRE string: o RA tem zeros à esquerda e vira outro número se passar por
 * Number em qualquer ponto do caminho.
 */
function normalizarRa(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor).replace(/\D/g, '');
}

/**
 * Valida SÓ O FORMATO do RA — 12 dígitos.
 *
 * Não existe validação de dígito verificador aqui, e é de propósito: o
 * algoritmo do DV do RA paulista não é público nem estável. Inventar um
 * cálculo faria o sistema recusar alunos reais, que é um erro muito pior do
 * que aceitar um RA digitado errado (esse a secretaria corrige; o aluno
 * recusado simplesmente não entra no sistema).
 */
function validarRa(valor) {
    const ra = normalizarRa(valor);
    if (!ra) return { ok: false, motivo: 'RA é obrigatório.' };
    if (!/^\d{12}$/.test(ra)) return { ok: false, motivo: 'RA deve ter 12 dígitos.' };
    return { ok: true, valor: ra };
}

/** Dígito verificador do RA: um caractere, 0-9 ou X. */
function validarDigitoRa(valor) {
    const bruto = String(valor === null || valor === undefined ? '' : valor)
        .trim()
        .toUpperCase();
    if (!bruto) return { ok: false, motivo: 'Dígito do RA é obrigatório.' };
    if (!/^[0-9X]$/.test(bruto)) return { ok: false, motivo: 'Dígito do RA deve ser 0-9 ou X.' };
    return { ok: true, valor: bruto };
}

/** UF do RA: duas letras. Default SP. */
function normalizarUfRa(valor) {
    const bruto = removerAcentos(String(valor === null || valor === undefined ? '' : valor))
        .trim()
        .toUpperCase();
    return /^[A-Z]{2}$/.test(bruto) ? bruto : 'SP';
}

// ─── Datas ───────────────────────────────────────────────────────────────────

/**
 * Converte "dd/MM/yyyy" para Date.
 *
 * Grava ao MEIO-DIA UTC, não à meia-noite. Data de nascimento é um valor de
 * CALENDÁRIO, não um instante: gravada à meia-noite UTC, ela é renderizada
 * como o dia anterior em qualquer fuso a oeste de Greenwich — inclusive
 * America/Sao_Paulo (UTC-3), que é o fuso de toda a rede. Meio-dia UTC mantém
 * o mesmo dia do calendário de UTC-11 a UTC+11.
 *
 * @returns {Date|null} null quando a data é inválida ou inexistente (31/02).
 */
function parseDataBr(valor) {
    if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
    const texto = colapsarEspacos(valor);
    if (!texto) return null;

    const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto);
    if (br) return montarData(+br[3], +br[2], +br[1]);

    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
    if (iso) return montarData(+iso[1], +iso[2], +iso[3]);

    return null;
}

/** Monta a Date validando que o dia realmente existe naquele mês. */
function montarData(ano, mes, dia) {
    if (!(ano >= 1900 && ano <= 2200) || !(mes >= 1 && mes <= 12) || !(dia >= 1 && dia <= 31))
        return null;
    const data = new Date(Date.UTC(ano, mes - 1, dia, 12, 0, 0));
    // Rejeita 31/02: o Date "corrige" para 03/03 e o mês deixa de bater.
    if (
        data.getUTCFullYear() !== ano ||
        data.getUTCMonth() !== mes - 1 ||
        data.getUTCDate() !== dia
    )
        return null;
    return data;
}

/**
 * Chave de comparação de data por CALENDÁRIO (yyyy-mm-dd em UTC).
 *
 * Usada para detectar divergência entre cadastro e arquivo. Comparar Date com
 * Date daria falso positivo entre um registro legado (gravado à meia-noite UTC
 * pelo importador antigo) e um novo (meio-dia UTC): mesma data, instantes
 * diferentes. Em UTC os dois rendem o mesmo yyyy-mm-dd.
 */
function chaveData(valor) {
    const data = valor instanceof Date ? valor : parseDataBr(valor);
    if (!data || Number.isNaN(data.getTime())) return '';
    return data.toISOString().slice(0, 10);
}

/** Formata para exibição em pt-BR (dd/mm/aaaa), lendo os campos em UTC. */
function formatarDataBr(valor) {
    const data = valor instanceof Date ? valor : parseDataBr(valor);
    if (!data || Number.isNaN(data.getTime())) return '';
    const dia = String(data.getUTCDate()).padStart(2, '0');
    const mes = String(data.getUTCMonth() + 1).padStart(2, '0');
    return `${dia}/${mes}/${data.getUTCFullYear()}`;
}

/** Idade em anos completos numa data de referência. */
function idadeEm(nascimento, referencia = new Date()) {
    const data = nascimento instanceof Date ? nascimento : parseDataBr(nascimento);
    if (!data) return null;
    let idade = referencia.getUTCFullYear() - data.getUTCFullYear();
    const mesRef = referencia.getUTCMonth();
    const diaRef = referencia.getUTCDate();
    if (
        mesRef < data.getUTCMonth() ||
        (mesRef === data.getUTCMonth() && diaRef < data.getUTCDate())
    )
        idade -= 1;
    return idade;
}

/**
 * Valida a data de nascimento.
 *
 * Idade fora da faixa 3–25 anos AVISA, não bloqueia: EJA, aluno retido e
 * matrícula fora de idade existem, e travar a importação por causa disso
 * empurraria a secretaria de volta para a digitação manual.
 */
function validarNascimento(valor, referencia = new Date()) {
    const data = parseDataBr(valor);
    if (!data) return { ok: false, motivo: 'Data de nascimento inválida (use dd/mm/aaaa).' };
    if (data.getTime() > referencia.getTime()) {
        return { ok: false, motivo: 'Data de nascimento está no futuro.' };
    }
    const idade = idadeEm(data, referencia);
    const avisos = [];
    if (idade !== null && (idade < 3 || idade > 25)) {
        avisos.push(`Idade calculada de ${idade} anos está fora da faixa usual (3 a 25).`);
    }
    return { ok: true, valor: data, avisos };
}

// ─── Situação do aluno ───────────────────────────────────────────────────────

/**
 * Rótulos que a SEDUC imprime na coluna "Situação", mapeados para o enum
 * interno. A lista é FECHADA de propósito: o parser do PDF depende dela para
 * separar a coluna Situação da coluna Deficiência (as duas contêm "Não").
 */
const SITUACOES_RELATORIO = [
    ['Não Comp.', 'nao_compareceu'],
    ['Nao Comp.', 'nao_compareceu'],
    ['Não Comp', 'nao_compareceu'],
    ['Nao Comp', 'nao_compareceu'],
    ['Transferido', 'transferido'],
    ['Remanejado', 'remanejado'],
    ['Reclassificado', 'outros'],
    ['Abandono', 'abandono'],
    ['Cessado', 'outros'],
    ['Outros', 'outros'],
    ['Ativo', 'ativo'],
];

const SITUACOES_VALIDAS = [
    'ativo',
    'transferido',
    'abandono',
    'nao_compareceu',
    'remanejado',
    'outros',
];

const ROTULO_SITUACAO = {
    ativo: 'Ativo',
    transferido: 'Transferido',
    abandono: 'Abandono',
    nao_compareceu: 'Não compareceu',
    remanejado: 'Remanejado',
    outros: 'Outros',
};

/** Converte o rótulo do relatório (ou o próprio enum) para o enum interno. */
function normalizarSituacao(valor) {
    const bruto = colapsarEspacos(valor);
    if (!bruto) return 'ativo';
    if (SITUACOES_VALIDAS.includes(bruto)) return bruto;

    const alvo = removerAcentos(bruto).toLowerCase().replace(/\./g, '');
    for (const [rotulo, enumValor] of SITUACOES_RELATORIO) {
        if (removerAcentos(rotulo).toLowerCase().replace(/\./g, '') === alvo) return enumValor;
    }
    return 'outros';
}

// ─── Deficiência / transtornos ───────────────────────────────────────────────

/** "Sim"/"Não" da coluna Deficiência → Boolean. */
function normalizarSimNao(valor) {
    const alvo = removerAcentos(colapsarEspacos(valor)).toLowerCase();
    if (!alvo) return false;
    return alvo === 'sim' || alvo === 's' || alvo === 'true' || alvo === '1';
}

/**
 * Quebra o texto livre da coluna "Transtorno(s)" em itens.
 * Aceita vírgula, ponto-e-vírgula, barra e " e " como separadores.
 */
function normalizarTranstornos(valor) {
    const texto = colapsarEspacos(valor);
    if (!texto) return [];
    return texto
        .split(/\s*[;,/]\s*|\s+e\s+/i)
        .map((item) => colapsarEspacos(item))
        .filter((item) => item.length > 1);
}

// ─── Número de chamada / série ───────────────────────────────────────────────

/** Número de chamada como inteiro positivo, ou null. */
function normalizarNumeroChamada(valor) {
    const bruto = normalizarRa(valor); // reaproveita: só dígitos
    if (!bruto) return null;
    const numero = parseInt(bruto, 10);
    return Number.isFinite(numero) && numero > 0 && numero <= 999 ? numero : null;
}

/** Série como string curta ("5", "1", "9"). */
function normalizarSerie(valor) {
    const texto = colapsarEspacos(valor);
    return texto ? texto.slice(0, 30) : '';
}

module.exports = {
    colapsarEspacos,
    removerAcentos,
    normalizarNome,
    tituloCase,
    validarNome,
    normalizarRa,
    validarRa,
    validarDigitoRa,
    normalizarUfRa,
    parseDataBr,
    chaveData,
    formatarDataBr,
    idadeEm,
    validarNascimento,
    normalizarSituacao,
    normalizarSimNao,
    normalizarTranstornos,
    normalizarNumeroChamada,
    normalizarSerie,
    SITUACOES_RELATORIO,
    SITUACOES_VALIDAS,
    ROTULO_SITUACAO,
};
