/**
 * auditarDependencias.test.js — Issue #588
 *
 * O gate de `npm audit` do CI (scripts/auditar-dependencias.js) aceita um
 * alerta só se ele estiver em audit-excecoes.json e dentro da data de revisão.
 * Qualquer outro alerta alto ou crítico continua reprovando.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const { avaliar, alertasDoRelatorio } = require(path.join(RAIZ, 'scripts/auditar-dependencias.js'));

/** Relatório no formato do `npm audit --json` (v7+). */
function relatorio(...alertas) {
    const vulnerabilities = {};
    for (const a of alertas) {
        vulnerabilities[a.pacote] = {
            name: a.pacote,
            severity: a.severidade,
            via: [
                {
                    source: 1,
                    name: a.pacote,
                    title: `alerta ${a.id}`,
                    url: `https://github.com/advisories/${a.id}`,
                    severity: a.severidade,
                },
            ],
        };
    }
    // Pacote afetado só de forma transitiva: `via` é string, não alerta próprio.
    vulnerabilities.dependente = { name: 'dependente', severity: 'high', via: ['braces'] };
    return { vulnerabilities };
}

const BRACES = { id: 'GHSA-vfj7-8cjw-p6xm', pacote: 'braces', severidade: 'high' };
const EXCECAO = { id: 'GHSA-vfj7-8cjw-p6xm', revisarAte: '2026-11-02', issue: 588 };

describe('avaliar', () => {
    it('aceita o alerta listado dentro da data', () => {
        const r = avaliar(relatorio(BRACES), [EXCECAO], '2026-10-03');
        expect(r.bloqueantes).toEqual([]);
        expect(r.aceitos.map((a) => a.id)).toEqual(['GHSA-vfj7-8cjw-p6xm']);
    });

    it('aceita no próprio dia da revisão e reprova no dia seguinte', () => {
        expect(avaliar(relatorio(BRACES), [EXCECAO], '2026-11-02').bloqueantes).toEqual([]);
        const depois = avaliar(relatorio(BRACES), [EXCECAO], '2026-11-03');
        expect(depois.bloqueantes).toHaveLength(1);
        expect(depois.bloqueantes[0].motivo).toMatch(/vencida em 2026-11-02/);
    });

    it('reprova alerta alto ou crítico que não está na lista', () => {
        const outro = { id: 'GHSA-aaaa-bbbb-cccc', pacote: 'outro', severidade: 'critical' };
        const r = avaliar(relatorio(BRACES, outro), [EXCECAO], '2026-10-03');
        expect(r.bloqueantes.map((b) => b.id)).toEqual(['GHSA-aaaa-bbbb-cccc']);
    });

    it('ignora o que está abaixo do nível', () => {
        const baixo = { id: 'GHSA-dddd-eeee-ffff', pacote: 'dompurify', severidade: 'low' };
        expect(avaliar(relatorio(baixo), [], '2026-10-03').bloqueantes).toEqual([]);
        expect(avaliar(relatorio(baixo), [], '2026-10-03', 'low').bloqueantes).toHaveLength(1);
    });

    it('avisa a exceção que não casou com nenhum alerta', () => {
        const r = avaliar(relatorio(), [EXCECAO], '2026-10-03');
        expect(r.semUso).toEqual(['GHSA-vfj7-8cjw-p6xm']);
    });

    it('conta só os alertas de origem, não os pacotes afetados por tabela', () => {
        expect(alertasDoRelatorio(relatorio(BRACES)).map((a) => a.pacote)).toEqual(['braces']);
    });

    it('nível desconhecido é erro, não gate aberto', () => {
        expect(() => avaliar(relatorio(), [], '2026-10-03', 'alto')).toThrow(/Nível desconhecido/);
    });
});

describe('exceções versionadas', () => {
    const { excecoes } = JSON.parse(
        fs.readFileSync(path.join(RAIZ, 'audit-excecoes.json'), 'utf8')
    );
    const trivy = fs
        .readFileSync(path.join(RAIZ, '.trivyignore'), 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));

    it.each(excecoes.map((e) => [e.id, e]))('%s tem motivo, Issue e data válida', (_id, e) => {
        expect(e.id).toMatch(/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
        expect(e.motivo.length).toBeGreaterThan(40);
        expect(Number.isInteger(e.issue)).toBe(true);
        expect(e.revisarAte).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('o .trivyignore lista os mesmos IDs, com a mesma data de expiração', () => {
        const doTrivy = trivy.map((l) => l.split(/\s+/)).map(([id, exp]) => `${id} ${exp}`);
        const esperado = excecoes.map((e) => `${e.id} exp:${e.revisarAte}`);
        expect(doTrivy.sort()).toEqual(esperado.sort());
    });
});
