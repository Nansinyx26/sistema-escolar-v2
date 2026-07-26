/**
 * DIAGNÓSTICO DE HTML ARMAZENADO
 *
 * USO: node scripts/diagnostico-html-armazenado.js
 * (requer MONGODB_URI no backend/.env — mesmo padrão do diagnostico-db.js)
 *
 * PARA QUE SERVE
 * --------------
 * Os renderizadores do frontend passaram a escapar HTML antes de injetar em
 * innerHTML. Isso levanta duas perguntas que SÓ o banco responde:
 *
 *   1. Existe payload perigoso já gravado? Se sim, ele estava executando no
 *      browser de quem abria a tela — e o escape acabou de neutralizá-lo.
 *      Isso é incidente ocorrido, não risco futuro: investigar e notificar.
 *
 *   2. Existe HTML de FORMATAÇÃO intencional gravado (<b>, <br>, <a>)? Se sim,
 *      esse conteúdo passa a aparecer como texto literal na tela. É regressão
 *      visual causada pela correção, e precisa de decisão: ou converter o dado,
 *      ou permitir uma allowlist de tags naquele campo específico.
 *
 * O script é SOMENTE LEITURA. Não altera nada.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('\n❌ ERRO: MONGODB_URI não encontrada!');
    console.error('   Crie backend/.env com:  MONGODB_URI=<connection string>\n');
    process.exit(1);
}

// ── Campos varridos ──────────────────────────────────────────────────────────
// Exatamente os que alimentam os renderizadores corrigidos. Acessamos as
// coleções pelo driver puro (não pelos models) para que `select: false` e
// transforms de schema não escondam nada da varredura.
const ALVOS = [
    { colecao: 'alunos', campos: ['nome', 'observacoes', 'condicao', 'nivel'], tela: 'Ata do conselho' },
    { colecao: 'comunicados', campos: ['titulo', 'conteudo', 'texto'], tela: 'Mural / comunicados' },
    { colecao: 'comentarios', campos: ['texto'], tela: 'Comentários do mural' },
    { colecao: 'usuarios', campos: ['nome', 'escola', 'disciplina'], tela: 'Cabeçalhos e listas' },
    { colecao: 'notificacoes', campos: ['titulo', 'mensagem'], tela: 'Sino de notificações' },
    { colecao: 'professores', campos: ['nome', 'disciplina'], tela: 'Grade horária / listas' },
    { colecao: 'turmas', campos: ['nome', 'turmaId'], tela: 'Grade horária' },
    { colecao: 'atribuicoes_professores', campos: ['nome', 'classe', 'serieTurma', 'observacoes'], tela: 'Lista de professores' },
    { colecao: 'atribuicoesprofessores', campos: ['nome', 'classe', 'serieTurma', 'observacoes'], tela: 'Lista de professores' }
];

// ── Classificação ────────────────────────────────────────────────────────────
// Ordem importa: perigoso é testado primeiro.
const PERIGOSO = [
    /<\s*script\b/i,
    /<\s*iframe\b/i,
    /<\s*object\b/i,
    /<\s*embed\b/i,
    /\son[a-z]+\s*=/i,          // onerror=, onclick=, onload=…
    /javascript\s*:/i,
    /vbscript\s*:/i,
    /data:text\/html/i,
    /<\s*img[^>]*\bon[a-z]+\s*=/i
];

const FORMATACAO = /<\s*\/?\s*(b|i|u|em|strong|br|p|ul|ol|li|span|div|a|h[1-6]|table|tr|td|font|small|sub|sup)\b[^>]*>/i;

// Conteúdo que JÁ está escapado no banco. Sinaliza risco de escape duplo:
// a tela mostraria `&lt;b&gt;` em vez de `<b>`.
const JA_ESCAPADO = /&(lt|gt|amp|quot|#39|#x27);/i;

function classificar(valor) {
    if (typeof valor !== 'string' || !valor) return null;
    for (const re of PERIGOSO) {
        if (re.test(valor)) return 'PERIGOSO';
    }
    if (FORMATACAO.test(valor)) return 'FORMATACAO';
    if (JA_ESCAPADO.test(valor)) return 'JA_ESCAPADO';
    // `<` solto sem formar tag: geralmente texto legítimo ("nota < 5")
    if (/[<>]/.test(valor)) return 'SINAL_SOLTO';
    return null;
}

function amostra(valor, limite = 160) {
    const s = String(valor).replace(/\s+/g, ' ').trim();
    return s.length > limite ? s.slice(0, limite) + '…' : s;
}

async function diagnosticar() {
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║   HTML ARMAZENADO — impacto do escape nos renderizadores  ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
    console.log(`Banco: ${MONGODB_URI.replace(/:([^@]+)@/, ':****@')}\n`);

    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
    const db = mongoose.connection.db;

    const existentes = new Set((await db.listCollections().toArray()).map(c => c.name));

    const achados = { PERIGOSO: [], FORMATACAO: [], JA_ESCAPADO: [], SINAL_SOLTO: [] };
    let documentosLidos = 0;

    for (const alvo of ALVOS) {
        if (!existentes.has(alvo.colecao)) continue;

        const cursor = db.collection(alvo.colecao).find({}, {
            projection: alvo.campos.reduce((p, c) => (p[c] = 1, p), { _id: 1 })
        });

        for await (const doc of cursor) {
            documentosLidos++;
            for (const campo of alvo.campos) {
                const tipo = classificar(doc[campo]);
                if (!tipo) continue;
                achados[tipo].push({
                    colecao: alvo.colecao,
                    tela: alvo.tela,
                    campo,
                    id: String(doc._id),
                    valor: amostra(doc[campo])
                });
            }
        }
    }

    console.log(`Documentos lidos: ${documentosLidos}\n`);

    // ── 1. Perigoso ──────────────────────────────────────────────────────────
    console.log('───────────────────────────────────────────────────────────');
    console.log('1) PAYLOAD PERIGOSO JÁ GRAVADO');
    console.log('───────────────────────────────────────────────────────────');
    if (!achados.PERIGOSO.length) {
        console.log('✅ Nenhum. Nenhum XSS armazenado chegou ao banco.\n');
    } else {
        console.log(`🚨 ${achados.PERIGOSO.length} ocorrência(s). ISTO É INCIDENTE OCORRIDO,`);
        console.log('   não risco futuro: esse conteúdo executava no browser de quem');
        console.log('   abria a tela. O escape neutraliza daqui pra frente, mas os');
        console.log('   dados devem ser investigados e o incidente avaliado (LGPD).\n');
        achados.PERIGOSO.forEach(a => {
            console.log(`   [${a.colecao}.${a.campo}] _id=${a.id}  (tela: ${a.tela})`);
            console.log(`      ${a.valor}\n`);
        });
    }

    // ── 2. Formatação intencional ────────────────────────────────────────────
    console.log('───────────────────────────────────────────────────────────');
    console.log('2) HTML DE FORMATAÇÃO (regressão visual do escape)');
    console.log('───────────────────────────────────────────────────────────');
    if (!achados.FORMATACAO.length) {
        console.log('✅ Nenhum. Escapar não altera a aparência de nada gravado.\n');
    } else {
        console.log(`⚠️  ${achados.FORMATACAO.length} valor(es) contêm tags de formatação.`);
        console.log('   Esses passam a aparecer como TEXTO LITERAL na tela.');
        console.log('   Decida por campo: converter o dado, ou liberar uma allowlist');
        console.log('   de tags só naquele campo (com sanitize-html, não sem escape).\n');
        const porCampo = {};
        achados.FORMATACAO.forEach(a => {
            const k = `${a.colecao}.${a.campo}`;
            (porCampo[k] = porCampo[k] || []).push(a);
        });
        Object.entries(porCampo).forEach(([k, lista]) => {
            console.log(`   ${k}: ${lista.length} ocorrência(s) — tela: ${lista[0].tela}`);
            lista.slice(0, 3).forEach(a => console.log(`      _id=${a.id}  ${a.valor}`));
            if (lista.length > 3) console.log(`      … mais ${lista.length - 3}`);
            console.log('');
        });
    }

    // ── 3. Já escapado ───────────────────────────────────────────────────────
    console.log('───────────────────────────────────────────────────────────');
    console.log('3) CONTEÚDO JÁ ESCAPADO (risco de escape duplo)');
    console.log('───────────────────────────────────────────────────────────');
    if (!achados.JA_ESCAPADO.length) {
        console.log('✅ Nenhum.\n');
    } else {
        console.log(`⚠️  ${achados.JA_ESCAPADO.length} valor(es) já contêm entidades HTML.`);
        console.log('   Na tela aparecerão como "&lt;b&gt;" em vez de "<b>".\n');
        achados.JA_ESCAPADO.slice(0, 5).forEach(a =>
            console.log(`   [${a.colecao}.${a.campo}] _id=${a.id}  ${a.valor}`));
        console.log('');
    }

    // ── 4. Sinais soltos ─────────────────────────────────────────────────────
    console.log('───────────────────────────────────────────────────────────');
    console.log('4) < ou > SOLTO (informativo — normalmente texto legítimo)');
    console.log('───────────────────────────────────────────────────────────');
    console.log(`ℹ️  ${achados.SINAL_SOLTO.length} ocorrência(s), ex.: "média < 5".`);
    console.log('   Antes do escape esses caracteres podiam quebrar o layout;');
    console.log('   agora renderizam corretamente.\n');
    achados.SINAL_SOLTO.slice(0, 3).forEach(a =>
        console.log(`   [${a.colecao}.${a.campo}] ${a.valor}`));

    // ── Veredito ─────────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('VEREDITO');
    console.log('═══════════════════════════════════════════════════════════');
    if (!achados.PERIGOSO.length && !achados.FORMATACAO.length && !achados.JA_ESCAPADO.length) {
        console.log('✅ Pode publicar. Nenhum dado gravado muda de aparência e');
        console.log('   nenhum payload malicioso foi encontrado.');
    } else {
        if (achados.PERIGOSO.length) console.log('🚨 Investigue os itens da seção 1 ANTES de publicar.');
        if (achados.FORMATACAO.length) console.log('⚠️  Confira visualmente as telas da seção 2 após publicar.');
        if (achados.JA_ESCAPADO.length) console.log('⚠️  Seção 3 indica dado escapado em dobro na origem.');
    }
    console.log('');

    await mongoose.disconnect();
}

diagnosticar().catch(async (e) => {
    console.error('\n❌ Falha no diagnóstico:', e.message);
    try { await mongoose.disconnect(); } catch (_) {}
    process.exit(1);
});
