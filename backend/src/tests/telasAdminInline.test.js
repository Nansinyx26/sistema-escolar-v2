/**
 * telasAdminInline.test.js — sanidade dos scripts inline das telas de admin.
 *
 * MOTIVO: `codigos-backup.html` declarava `var API = '<string>'` e foi ganhando,
 * patch após patch, chamadas no formato `API()`. Toda aba nova quebrava com
 * "API is not a function" — em PRODUÇÃO, porque `node --check` valida sintaxe e
 * isso é erro de tipo em tempo de execução.
 *
 * Estes testes não substituem testar a tela de verdade. Eles pegam a classe
 * específica de erro que passou: script inline que nem chega a rodar.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '../../../html/admin');
const PAGINAS = fs.readdirSync(RAIZ).filter((f) => f.endsWith('.html'));

/** Extrai todos os blocos <script> sem `src` de um HTML. */
function scriptsInline(html) {
    const blocos = [];
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        if (m[1].trim()) blocos.push(m[1]);
    }
    return blocos;
}

/** Remove comentarios de bloco e de linha, para nao contar exemplos em prosa. */
function semComentarios(codigo) {
    return codigo
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');   // o [^:] evita cortar https://
}

describe('Scripts inline das telas administrativas', () => {
    it.each(PAGINAS)('%s — todo script inline compila', (pagina) => {
        const html = fs.readFileSync(path.join(RAIZ, pagina), 'utf8');
        scriptsInline(html).forEach((codigo, i) => {
            // `new vm.Script` faz o parse real do V8 e lança em erro de sintaxe.
            expect(() => new vm.Script(codigo, { filename: `${pagina}#${i}` })).not.toThrow();
        });
    });

    it.each(PAGINAS)('%s — `API` e usada de forma consistente', (pagina) => {
        const html = fs.readFileSync(path.join(RAIZ, pagina), 'utf8');
        // Comentarios fora: este proprio arquivo documenta o bug escrevendo
        // o exemplo em prosa, e conta-lo daria falso positivo.
        const codigo = semComentarios(scriptsInline(html).join('\n'));

        const declaradaFuncao = /\bvar\s+API\s*=\s*function\b|\bconst\s+API\s*=\s*\(\)\s*=>/.test(codigo);
        const declaradaValor = /\b(var|const|let)\s+API\s*=\s*(window\.|'|")/.test(codigo);
        if (!declaradaFuncao && !declaradaValor) return; // a pagina nao usa `API`

        // Conta os dois estilos de uso, ignorando a linha de declaracao.
        const usoChamada = (codigo.match(/\bAPI\(\)/g) || []).length;
        const usoConcat = (codigo.match(/\bAPI\s*\+/g) || []).length;

        // Misturar os dois e o bug: um dos lados vai estourar em runtime.
        expect(`${pagina}: chamada=${usoChamada} concat=${usoConcat}`)
            .toBe(`${pagina}: chamada=${usoChamada} concat=${declaradaFuncao ? 0 : usoConcat}`);

        if (declaradaFuncao) expect(usoConcat).toBe(0);
        if (declaradaValor && !declaradaFuncao) expect(usoChamada).toBe(0);
    });
});
