/**
 * scriptsInlineSintaxe.test.js — Issue #632
 *
 * Um script de injeção (scripts/inject-*.js) achou o `</body></html>` que
 * existia DENTRO de uma string JavaScript, no imprimirDoc() da página de
 * documentos da secretaria, e colou ali tags `<script src=...></script>`. O
 * navegador encerra o `<script>` inline no primeiro `</script>` que encontra:
 * o bloco terminava no meio da string, e a página inteira ficou sem
 * JavaScript, sem que nada acusasse.
 *
 * Este teste recorta cada `<script>` inline das páginas como o navegador
 * recorta e confere a sintaxe. Página nova ou injeção nova que corte um script
 * reprova aqui, não em produção.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.resolve(__dirname, '../../..');

// O portal é React compilado pelo Vite, com os próprios testes de tipo e build.
const FORA = [/^portal-responsavel\//, /node_modules\//];
// Blocos que o navegador não executa como script clássico.
const NAO_EXECUTAVEL =
    /type\s*=\s*["']?(module|importmap|application\/(ld\+)?json|text\/(template|x-template|html))/i;

/** Páginas versionadas: o disco pode ter relatório HTML gerado (Issue #267). */
function paginas() {
    return execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '*.html'],
        {
            cwd: RAIZ,
            encoding: 'utf8',
        }
    )
        .split('\n')
        .filter((f) => f && !FORA.some((re) => re.test(f)))
        .filter((f) => fs.existsSync(path.join(RAIZ, f)));
}

/** `[{ linha, codigo }]` dos scripts inline, recortados no primeiro `</script>`. */
function scriptsInline(html) {
    const blocos = [];
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m = re.exec(html);
    while (m) {
        const [, atributos, codigo] = m;
        if (!/\bsrc\s*=/.test(atributos) && !NAO_EXECUTAVEL.test(atributos)) {
            blocos.push({ linha: html.slice(0, m.index).split('\n').length, codigo });
        }
        m = re.exec(html);
    }
    return blocos;
}

describe('scripts inline das páginas (Issue #632)', () => {
    it('nenhum script inline termina no meio do código', () => {
        const quebrados = [];
        for (const pagina of paginas()) {
            const html = fs.readFileSync(path.join(RAIZ, pagina), 'utf8');
            for (const { linha, codigo } of scriptsInline(html)) {
                try {
                    new vm.Script(codigo, { filename: `${pagina}:${linha}` });
                } catch (erro) {
                    quebrados.push(`${pagina}:${linha} — ${erro.message}`);
                }
            }
        }
        expect(quebrados).toEqual([]);
    });

    it('a varredura enxerga o corte que quebrou a página de documentos', () => {
        const html = `<script>
            function imprimir() {
                w.document.write(\`<body>\${x}
                <script src="../../js/motion.js"></script>
                </body>\`);
            }
        </script>`;
        const [bloco] = scriptsInline(html);

        // Pela mensagem: o SyntaxError do vm é de outro realm que o do Jest.
        expect(() => new vm.Script(bloco.codigo)).toThrow('Unexpected end of input');
    });
});
