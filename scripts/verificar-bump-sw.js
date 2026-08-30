#!/usr/bin/env node
/**
 * verificar-bump-sw.js — tira da memória de quem commita o bump do VERSION.
 *
 * POR QUE ESTE ARQUIVO EXISTE (Issue #128)
 * ----------------------------------------
 * O `service-worker.js` guarda os assets em stale-while-revalidate e depende de
 * um número escrito à mão para invalidar o cache. Sem trocar `VERSION`, o
 * usuário recebe o arquivo ANTIGO no primeiro acesso depois do deploy.
 *
 * Um passo obrigatório, manual, sem verificação, num arquivo que quase ninguém
 * abre — e já esquecido: o commit `059577d` ("fix(perfil): resolver o perfil
 * ativo numa unica funcao") mudou `js/auth.js` sem trocar a versão. Só não
 * causou dano porque outro commit bumpou antes do release. Sorte de sequência,
 * não processo.
 *
 * Aqui importa mais que num projeto qualquer: `js/auth.js` e
 * `js/guarda-acesso.js` estão na shell mínima, e o guard é o que impede uma
 * página restrita em cache de aparecer sem verificação depois de um logout ou
 * numa troca de conta. Servir a versão anterior desses dois não deixa a
 * interface feia — deixa a checagem de acesso desatualizada no aparelho.
 *
 * A LISTA É LIDA DO PRÓPRIO SERVICE WORKER
 * ----------------------------------------
 * `STATIC_ASSETS` é extraído executando o `service-worker.js` num contexto
 * isolado, e não de uma cópia mantida aqui. Uma cópia sai de sincronia no dia
 * em que alguém acrescenta um asset — e a verificação passaria a mentir
 * exatamente quando mais importa.
 *
 * USO
 *   node scripts/verificar-bump-sw.js [--base <ref>]
 *
 *   --base   ref de comparação (padrão: origin/develop, ou origin/$GITHUB_BASE_REF)
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..');
const SW = path.join(RAIZ, 'service-worker.js');

function baseEscolhida() {
    const i = process.argv.indexOf('--base');
    if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
    return `origin/${process.env.GITHUB_BASE_REF || 'develop'}`;
}

function git(...args) {
    return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' }).trim();
}

/**
 * Executa o service worker num contexto de mentira só para ler as constantes.
 * Os `addEventListener` do topo precisam de um `self`; nada mais é tocado,
 * porque os handlers só rodam quando um evento chega — e nenhum chega aqui.
 */
function lerConstantesDoServiceWorker(fonte) {
    const contexto = {
        self: { addEventListener: () => {}, location: { origin: 'https://exemplo' } },
        caches: {},
        fetch: () => {},
        URL,
        Response: class {},
        Request: class {},
        console: { log: () => {} },
    };
    vm.createContext(contexto);

    // `const` de topo não vira propriedade do contexto (só `var` e declarações
    // de função viram), então a linha abaixo é anexada à MESMA execução para
    // publicar os valores. É o que permite ler a lista real em vez de manter
    // uma cópia aqui.
    vm.runInContext(`${fonte}\n;globalThis.__constantes = { VERSION, STATIC_ASSETS };`, contexto);

    return contexto.__constantes || {};
}

/** '/' é o index; o resto é caminho a partir da raiz do repositório. */
function paraCaminhoDeRepositorio(url) {
    const semQuery = String(url).split('?')[0];
    if (semQuery === '/') return 'index.html';
    return semQuery.replace(/^\//, '');
}

function main() {
    const base = baseEscolhida();

    let alterados;
    try {
        alterados = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
    } catch (err) {
        console.error(
            `::error title=Verificação do VERSION::não foi possível comparar com \`${base}\`. ` +
                'No CI, o checkout precisa de `fetch-depth: 0`.'
        );
        process.exit(1);
    }

    const fonteAtual = fs.readFileSync(SW, 'utf8');
    const { VERSION, STATIC_ASSETS } = lerConstantesDoServiceWorker(fonteAtual);

    if (!VERSION || !Array.isArray(STATIC_ASSETS)) {
        console.error(
            '::error title=Verificação do VERSION::não consegui ler `VERSION`/`STATIC_ASSETS` ' +
                'do service-worker.js. Se a estrutura do arquivo mudou, ajuste este script — ' +
                'não o remova: sem ele o bump volta a depender de memória.'
        );
        process.exit(1);
    }

    const cacheados = new Set(STATIC_ASSETS.map(paraCaminhoDeRepositorio));
    const tocados = alterados.filter((arquivo) => cacheados.has(arquivo));

    if (tocados.length === 0) {
        console.log(`✅ Nenhum arquivo de STATIC_ASSETS alterado (base: ${base}).`);
        return;
    }

    let versaoBase;
    try {
        const fonteBase = git('show', `${base}:service-worker.js`);
        versaoBase = lerConstantesDoServiceWorker(fonteBase).VERSION;
    } catch (err) {
        // Service worker novo na base: não há versão anterior para comparar.
        console.log('✅ service-worker.js não existe na base; nada a comparar.');
        return;
    }

    if (versaoBase !== VERSION) {
        console.log(
            `✅ ${tocados.length} arquivo(s) de STATIC_ASSETS alterado(s) e VERSION ` +
                `foi de ${versaoBase} para ${VERSION}.`
        );
        return;
    }

    const lista = tocados.map((a) => `  - ${a}`).join('\n');
    console.error(
        `::error title=Bump do VERSION esquecido::Arquivos da shell do service worker mudaram ` +
            `sem trocar VERSION (segue em ${VERSION}).`
    );
    console.error(
        `\nArquivos alterados que estão em STATIC_ASSETS:\n${lista}\n\n` +
            'Eles usam stale-while-revalidate: sem trocar a versão, o usuário recebe o\n' +
            'arquivo ANTIGO no primeiro acesso após o deploy. Em js/auth.js e\n' +
            'js/guarda-acesso.js isso significa checagem de acesso desatualizada no\n' +
            'aparelho, não só interface velha.\n\n' +
            `Conserto: troque VERSION em service-worker.js (hoje ${VERSION}).`
    );
    process.exit(1);
}

main();
