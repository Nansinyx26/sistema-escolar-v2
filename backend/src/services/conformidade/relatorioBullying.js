/**
 * relatorioBullying.js — relatório bimestral de intimidação sistemática
 * (Lei 13.185/2015, art. 6º — Issue #512).
 *
 * "Serão produzidos e publicados relatórios bimestrais das ocorrências de
 * intimidação sistemática (bullying)". A fonte são as denúncias do canal
 * aberto (`ModeracaoOcorrencia`, camada `denuncia`) de `bullying` e
 * `ciberbullying`.
 *
 * O relatório é feito para ser PUBLICADO, então segue a mesma regra dos dados
 * abertos (`dadosAbertos.js`): só contagem, nenhum identificador, e supressão
 * com limiar k = 5. Numa escola pequena, "1 denúncia de ciberbullying no 5º
 * ano" aponta para uma criança; por isso total abaixo do limiar não é
 * publicado como número, e as distribuições passam por `agruparPequenos`.
 *
 * Bimestre CIVIL (jan–fev = 1, …, nov–dez = 6), no fuso de Brasília: a lei fala
 * em relatório bimestral, não em bimestre letivo, e o calendário civil é o
 * mesmo para toda a rede — o que permite somar escolas depois.
 */

const ModeracaoOcorrencia = require('../../models/ModeracaoOcorrencia');
const { LIMIAR_ANONIMATO, agruparPequenos } = require('./dadosAbertos');

const CATEGORIAS = ['bullying', 'ciberbullying'];

const ROTULO_CATEGORIA = {
    bullying: 'Intimidação sistemática (bullying)',
    ciberbullying: 'Intimidação sistemática na internet (cyberbullying)',
};

/**
 * Apuração em curso ou concluída. Os estados da fila de moderação
 * (`mantida`, `revertida`, `expirada`) falam da decisão sobre conteúdo, não do
 * mérito da denúncia; publicar "procedente/improcedente" a partir deles seria
 * afirmar o que o dado não diz.
 */
function rotuloSituacao(statusAtual) {
    return statusAtual === 'pendente' ? 'Em apuração' : 'Apuração concluída';
}

/** Brasil sem horário de verão desde 2019: -03:00 fixo. */
function inicioDoMes(ano, mesIndice) {
    const a = ano + Math.floor(mesIndice / 12);
    const m = (mesIndice % 12) + 1;
    return new Date(`${a}-${String(m).padStart(2, '0')}-01T00:00:00-03:00`);
}

/**
 * Janela do bimestre civil, meio-aberta: [inicio, fim).
 * @param {number} ano
 * @param {number} bimestre 1..6
 */
function periodoDoBimestre(ano, bimestre) {
    const primeiroMes = (bimestre - 1) * 2;
    return { inicio: inicioDoMes(ano, primeiroMes), fim: inicioDoMes(ano, primeiroMes + 2) };
}

/** Bimestre civil de uma data, no fuso de Brasília. */
function bimestreDe(data = new Date()) {
    const local = new Date(data.getTime() - 3 * 60 * 60 * 1000);
    return { ano: local.getUTCFullYear(), bimestre: Math.floor(local.getUTCMonth() / 2) + 1 };
}

/**
 * Monta o relatório de uma escola (ou da rede, sem filtro) num bimestre.
 *
 * @param {object} opcoes
 * @param {object} [opcoes.filtroEscola={}] match de tenant.
 * @param {number} opcoes.ano
 * @param {number} opcoes.bimestre 1..6
 * @returns {Promise<object>} contagens agregadas, sem identificador.
 */
async function montarRelatorio({ filtroEscola = {}, ano, bimestre }) {
    const { inicio, fim } = periodoDoBimestre(ano, bimestre);

    const linhas = await ModeracaoOcorrencia.aggregate([
        {
            $match: {
                ...filtroEscola,
                camada: 'denuncia',
                categoriaDenuncia: { $in: CATEGORIAS },
                criadoEm: { $gte: inicio, $lt: fim },
            },
        },
        {
            $group: {
                _id: { categoria: '$categoriaDenuncia', status: '$statusAtual' },
                total: { $sum: 1 },
            },
        },
    ]);

    const somar = (chaveDe) => {
        const mapa = new Map();
        for (const l of linhas) {
            const chave = chaveDe(l._id);
            mapa.set(chave, (mapa.get(chave) || 0) + l.total);
        }
        return Array.from(mapa, ([chave, valor]) => ({ chave, valor }));
    };

    const total = linhas.reduce((s, l) => s + l.total, 0);
    const publicavel = total === 0 || total >= LIMIAR_ANONIMATO;

    return {
        metadados: {
            baseLegal: 'Lei 13.185/2015, art. 6º',
            ano,
            bimestre,
            periodo: { inicio, fim },
            limiarAnonimato: LIMIAR_ANONIMATO,
            fonte: 'Canal de denúncia do sistema (categorias bullying e ciberbullying)',
            geradoEm: new Date(),
        },
        // Total abaixo do limiar vira faixa: publicar "3" numa escola de uma
        // turma por série identifica quem denunciou e quem foi denunciado.
        total: publicavel ? total : null,
        totalAbaixoDoLimiar: !publicavel,
        porCategoria: publicavel
            ? agruparPequenos(somar((id) => ROTULO_CATEGORIA[id.categoria])).itens
            : [],
        porSituacao: publicavel
            ? agruparPequenos(somar((id) => rotuloSituacao(id.status))).itens
            : [],
    };
}

module.exports = { montarRelatorio, periodoDoBimestre, bimestreDe };
