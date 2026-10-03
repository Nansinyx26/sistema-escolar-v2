#!/usr/bin/env node
/**
 * auditar-dependencias.js — o gate de `npm audit` do CI, com exceção por alerta.
 *
 * POR QUE ESTE ARQUIVO EXISTE (Issue #588)
 * ----------------------------------------
 * O CI rodava `npm audit --audit-level=high` no backend, na raiz e no portal.
 * Em 2026-10-03 saiu o GHSA-vfj7-8cjw-p6xm (braces <=3.0.3, alto) sem versão
 * corrigida, e ele chega pelo jest, pelo nodemon e pelo tailwind. O gate
 * reprovou todo PR e a própria `develop` — e com o Security Scan vermelho o
 * deploy de dev deixou de rodar, inclusive o das correções de segurança.
 *
 * O `npm audit` não tem como ignorar um alerta específico: as saídas eram
 * auditar só produção (`--omit=dev`, contra a decisão documentada no
 * ci-cd.yml de olhar também as ferramentas de dev) ou esperar um patch sem
 * data. Este script mantém o gate inteiro — produção E desenvolvimento, alto e
 * crítico — e aceita só o que está em `audit-excecoes.json`, uma entrada por
 * alerta, com motivo e data de revisão.
 *
 * A DATA NÃO É ENFEITE
 * --------------------
 * Passada `revisarAte`, a exceção deixa de valer e o gate volta a reprovar,
 * dizendo qual exceção venceu. Exceção sem prazo vira exceção para sempre.
 * Uma exceção que não aparece mais no relatório (o alerta foi corrigido) é
 * avisada no log, para ser removida.
 *
 * USO
 *   node scripts/auditar-dependencias.js [--dir <pasta>] [--nivel high|critical]
 *
 *   --dir    pasta com o package-lock.json (padrão: a raiz do repositório)
 *   --nivel  severidade mínima que reprova (padrão: high)
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');
const ARQUIVO_EXCECOES = path.join(RAIZ, 'audit-excecoes.json');
const ORDEM = ['info', 'low', 'moderate', 'high', 'critical'];

/** "https://github.com/advisories/GHSA-xxxx" → "GHSA-xxxx". */
function idDoAlerta(via) {
    const url = String(via.url || '');
    const ghsa = url.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i);
    return ghsa ? ghsa[0] : String(via.source || url);
}

/** Alertas de origem do relatório (os objetos em `via`), sem repetição. */
function alertasDoRelatorio(relatorio) {
    const vistos = new Map();
    for (const pacote of Object.values(relatorio.vulnerabilities || {})) {
        for (const via of pacote.via || []) {
            if (!via || typeof via !== 'object') continue; // string = efeito transitivo
            const id = idDoAlerta(via);
            const chave = `${id}|${via.name}`;
            if (!vistos.has(chave)) {
                vistos.set(chave, {
                    id,
                    pacote: via.name,
                    severidade: via.severity,
                    titulo: via.title,
                    url: via.url,
                });
            }
        }
    }
    return [...vistos.values()];
}

/**
 * Decide o gate. Puro: recebe o relatório do `npm audit --json`, a lista de
 * exceções e a data de hoje (AAAA-MM-DD), e devolve o que reprova, o que foi
 * aceito e as exceções que não casaram com nada.
 */
function avaliar(relatorio, excecoes, hoje, nivel = 'high') {
    const minimo = ORDEM.indexOf(nivel);
    if (minimo < 0) throw new Error(`Nível desconhecido: ${nivel}`);

    const porId = new Map((excecoes || []).map((e) => [e.id, e]));
    const usadas = new Set();
    const bloqueantes = [];
    const aceitos = [];

    for (const alerta of alertasDoRelatorio(relatorio)) {
        if (ORDEM.indexOf(alerta.severidade) < minimo) continue;
        const excecao = porId.get(alerta.id);
        if (!excecao) {
            bloqueantes.push({ ...alerta, motivo: 'sem exceção' });
            continue;
        }
        usadas.add(alerta.id);
        if (hoje > excecao.revisarAte) {
            bloqueantes.push({
                ...alerta,
                motivo: `exceção vencida em ${excecao.revisarAte} (Issue #${excecao.issue})`,
            });
        } else {
            aceitos.push({ ...alerta, revisarAte: excecao.revisarAte, issue: excecao.issue });
        }
    }

    const semUso = (excecoes || []).filter((e) => !usadas.has(e.id)).map((e) => e.id);
    return { bloqueantes, aceitos, semUso };
}

function lerArgumentos(argv) {
    const args = { dir: RAIZ, nivel: 'high' };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--dir') args.dir = path.resolve(RAIZ, argv[++i]);
        else if (argv[i] === '--nivel') args.nivel = argv[++i];
    }
    return args;
}

function rodarNpmAudit(dir) {
    try {
        return execFileSync('npm', ['audit', '--json'], { cwd: dir, encoding: 'utf8' });
    } catch (erro) {
        // `npm audit` sai com código != 0 quando há vulnerabilidade: o JSON vem
        // no stdout do erro. Sem stdout é falha de verdade (rede, lockfile).
        if (erro.stdout) return erro.stdout;
        throw erro;
    }
}

function main() {
    const { dir, nivel } = lerArgumentos(process.argv.slice(2));
    const relatorio = JSON.parse(rodarNpmAudit(dir));
    if (relatorio.error) {
        console.error('npm audit falhou:', relatorio.error.summary || relatorio.error);
        process.exit(1);
    }

    const { excecoes } = JSON.parse(fs.readFileSync(ARQUIVO_EXCECOES, 'utf8'));
    const hoje = new Date().toISOString().slice(0, 10);
    const { bloqueantes, aceitos, semUso } = avaliar(relatorio, excecoes, hoje, nivel);
    const rotulo = path.relative(RAIZ, dir) || '.';

    for (const a of aceitos) {
        console.log(
            `⚠️  [${rotulo}] ${a.id} (${a.pacote}, ${a.severidade}) aceito até ${a.revisarAte} — Issue #${a.issue}`
        );
    }
    for (const id of semUso) {
        console.log(`ℹ️  [${rotulo}] exceção ${id} não aparece neste relatório.`);
    }
    if (bloqueantes.length > 0) {
        for (const b of bloqueantes) {
            console.error(
                `❌ [${rotulo}] ${b.id} (${b.pacote}, ${b.severidade}): ${b.titulo} — ${b.motivo}\n   ${b.url}`
            );
        }
        process.exit(1);
    }
    console.log(`✅ [${rotulo}] nenhum alerta ${nivel} ou acima fora das exceções.`);
}

if (require.main === module) main();

module.exports = { avaliar, alertasDoRelatorio };
