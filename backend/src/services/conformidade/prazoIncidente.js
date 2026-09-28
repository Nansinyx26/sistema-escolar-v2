/**
 * prazoIncidente.js — prazo de comunicação de incidente à ANPD (Resolução
 * CD/ANPD nº 15/2024 — Issue #513).
 *
 * "Três dias úteis, contados do conhecimento pelo controlador de que o
 * incidente afetou dados pessoais." Contagem como a de prazo processual: o dia
 * da ciência não conta, e o prazo vence no FIM do 3º dia útil seguinte, no
 * fuso de Brasília.
 *
 * Dias não úteis: sábado, domingo e os feriados nacionais FIXOS em lei
 * (Leis 662/1949, 6.802/1980 e 14.759/2023). A Sexta-feira Santa, o Carnaval e
 * o Corpus Christi ficam de fora de propósito: não são feriados nacionais
 * fixos, e tratá-los como não úteis empurraria o prazo para depois. Errar,
 * aqui, tem de ser para o lado de comunicar mais cedo.
 */

const DIAS_UTEIS_ANPD = 3;
const FUSO_BRASILIA_MS = 3 * 60 * 60 * 1000; // -03:00, sem horário de verão desde 2019
const DIA_MS = 24 * 60 * 60 * 1000;

/** MM-DD dos feriados nacionais fixos. */
const FERIADOS_NACIONAIS = new Set([
    '01-01', // Confraternização Universal
    '04-21', // Tiradentes
    '05-01', // Dia do Trabalho
    '09-07', // Independência
    '10-12', // Nossa Senhora Aparecida
    '11-02', // Finados
    '11-15', // Proclamação da República
    '11-20', // Dia Nacional de Zumbi e da Consciência Negra (Lei 14.759/2023)
    '12-25', // Natal
]);

/** Data local de Brasília como meia-noite UTC do mesmo dia civil. */
function diaCivil(data) {
    const local = new Date(new Date(data).getTime() - FUSO_BRASILIA_MS);
    return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

function ehDiaUtil(dia) {
    const semana = dia.getUTCDay();
    if (semana === 0 || semana === 6) return false;
    const mmdd = `${String(dia.getUTCMonth() + 1).padStart(2, '0')}-${String(dia.getUTCDate()).padStart(2, '0')}`;
    return !FERIADOS_NACIONAIS.has(mmdd);
}

/**
 * Último instante do prazo: 23:59:59.999 (Brasília) do N-ésimo dia útil
 * depois do dia da ciência.
 *
 * @param {Date|string} cienciaEm
 * @param {number} [diasUteis=3]
 * @returns {Date}
 */
function prazoDeComunicacao(cienciaEm, diasUteis = DIAS_UTEIS_ANPD) {
    let dia = diaCivil(cienciaEm);
    let contados = 0;
    while (contados < diasUteis) {
        dia = new Date(dia.getTime() + DIA_MS);
        if (ehDiaUtil(dia)) contados += 1;
    }
    return new Date(dia.getTime() + DIA_MS - 1 + FUSO_BRASILIA_MS);
}

module.exports = { prazoDeComunicacao };
