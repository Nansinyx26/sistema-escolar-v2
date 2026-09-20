/**
 * escopoAlunos.js — os nomes de aluno que podem aparecer no texto (Issue #401).
 *
 * A pseudonimização dos DADOS resolve metade do problema: a outra metade é o
 * que a pessoa digita. "Como está o João da Silva?" leva o nome de uma criança
 * para fora do servidor antes de qualquer consulta.
 *
 * Aqui se carrega a lista de nomes que aquela pessoa poderia estar citando — os
 * alunos das turmas dela, ou da escola dela — para trocar cada ocorrência por um
 * rótulo antes do envio. A lista fica em cache curto por escopo, porque a mesma
 * conversa faz várias chamadas seguidas.
 */
const Aluno = require('../../models/Aluno');

const TTL_MS = 60_000;
const LIMITE = 3000;
const cache = new Map(); // chave do escopo → { at, alunos }

function chaveDoEscopo(ctx) {
    const turmas = (ctx?.turmas || []).slice().sort().join('|');
    return `${ctx?.escolaId || 'sem-escola'}::${ctx?.usuario?.perfil || '?'}::${turmas}`;
}

/** Filtro por escola e, para professor, pelas turmas dele. */
function filtro(ctx) {
    const f = { ativo: { $ne: false } };
    if (ctx?.escolaId) f.escolaId = String(ctx.escolaId);
    if (String(ctx?.usuario?.perfil).toLowerCase() === 'professor') {
        const turmas = ctx.turmas || [];
        f.$or = [{ turma: { $in: turmas } }, { turmaId: { $in: turmas } }];
    }
    return f;
}

/** @returns {Promise<Array<{id: string, nome: string}>>} */
async function alunosDoEscopo(ctx) {
    const chave = chaveDoEscopo(ctx);
    const emCache = cache.get(chave);
    if (emCache && Date.now() - emCache.at < TTL_MS) return emCache.alunos;

    const docs = await Aluno.find(filtro(ctx)).select('nome sobrenome').limit(LIMITE).lean();
    const alunos = docs.map((a) => ({
        id: String(a._id),
        nome: [a.nome, a.sobrenome].filter(Boolean).join(' ').trim(),
    }));
    cache.set(chave, { at: Date.now(), alunos });
    return alunos;
}

function escaparRegex(v) {
    return String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Troca, no texto, todo nome de aluno do escopo pelo rótulo do mapa.
 * Os nomes maiores vêm primeiro: "João da Silva" antes de "João", senão o
 * sobrenome ficaria solto no texto enviado.
 */
async function mascararTexto(texto, ctx, mapa) {
    const original = String(texto ?? '');
    if (!original.trim()) return original;

    const alunos = await alunosDoEscopo(ctx);
    let saida = original;
    const porTamanho = alunos
        .filter((a) => a.nome && a.nome.length >= 3)
        .sort((a, b) => b.nome.length - a.nome.length);

    for (const aluno of porTamanho) {
        const regex = new RegExp(`\\b${escaparRegex(aluno.nome)}\\b`, 'gi');
        if (!regex.test(saida)) continue;
        const rotulo = mapa.registrarAluno({ id: aluno.id, nome: aluno.nome });
        saida = saida.replace(new RegExp(`\\b${escaparRegex(aluno.nome)}\\b`, 'gi'), rotulo);
    }

    // Nome composto citado só pelo primeiro nome ("o João"): o laço acima já
    // cobre, porque o primeiro nome também está na lista quando o cadastro só
    // tem um nome. Nome parcial de cadastro composto é limitação conhecida:
    // vale para o texto livre, não para os dados, que vão sempre mascarados.
    return saida;
}

/**
 * true se o texto cita o nome de algum aluno da escola (Issue #401).
 *
 * Usado pela narração: o texto lido em voz alta vai para um provedor externo,
 * e um boletim narrado levaria o nome da criança junto. A consulta é feita no
 * escopo da ESCOLA (e não das turmas de quem pediu), porque aqui o objetivo é
 * barrar, e barrar a mais é o lado seguro do erro.
 */
async function textoTemNomeDeAluno(texto, ctx) {
    const original = String(texto ?? '');
    if (!original.trim()) return false;
    const alunos = await alunosDoEscopo({ escolaId: ctx?.escolaId, usuario: { perfil: 'gestao' } });
    return alunos.some(
        (a) =>
            a.nome &&
            a.nome.length >= 3 &&
            new RegExp(`\\b${escaparRegex(a.nome)}\\b`, 'i').test(original)
    );
}

/** Limpa o cache — usado nos testes e quando o cadastro muda em massa. */
function limparCache() {
    cache.clear();
}

module.exports = { alunosDoEscopo, mascararTexto, textoTemNomeDeAluno, limparCache };
