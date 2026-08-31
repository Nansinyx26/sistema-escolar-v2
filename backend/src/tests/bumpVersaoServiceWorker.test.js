/**
 * bumpVersaoServiceWorker.test.js — Issue #128
 *
 * O critério de aceite que mais importa não é "a verificação existe": é que ela
 * enxergue a LISTA REAL do `service-worker.js`, e não uma cópia que sai de
 * sincronia no dia em que alguém acrescenta um asset — que é justamente quando
 * a verificação passaria a mentir.
 *
 * Por isso o que se testa aqui é o acoplamento: acrescentar um asset ao service
 * worker precisa mudar o que a verificação vê, sem tocar em mais nada.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RAIZ = path.join(__dirname, '../../..');
const SCRIPT = path.join(RAIZ, 'scripts', 'verificar-bump-sw.js');

/** Carrega a função de leitura do script, do jeito que ele mesmo a usa. */
function lerListaDoServiceWorker(fonteSw) {
    const vm = require('node:vm');
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
    vm.runInContext(`${fonteSw}\n;globalThis.__c = { VERSION, STATIC_ASSETS };`, contexto);
    return contexto.__c;
}

describe('verificação do bump do VERSION (Issue #128)', () => {
    const fonteSw = fs.readFileSync(path.join(RAIZ, 'service-worker.js'), 'utf8');

    test('o script existe e está no npm run sw:verificar', () => {
        expect(fs.existsSync(SCRIPT)).toBe(true);
        const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
        expect(pkg.scripts['sw:verificar']).toContain('verificar-bump-sw.js');
    });

    test('a lista vista pela verificação é a do service worker, não uma cópia', () => {
        const { STATIC_ASSETS } = lerListaDoServiceWorker(fonteSw);

        expect(Array.isArray(STATIC_ASSETS)).toBe(true);
        expect(STATIC_ASSETS).toContain('/js/auth.js');
        expect(STATIC_ASSETS).toContain('/js/guarda-acesso.js');

        // O script não pode carregar nenhuma lista própria: se acrescentar um
        // asset ao service worker não mudasse o que ele vê, a verificação
        // estaria olhando para outro lugar.
        const comAssetNovo = fonteSw.replace(
            'const STATIC_ASSETS = [',
            "const STATIC_ASSETS = [\n    '/js/asset-inventado-neste-teste.js',"
        );
        expect(lerListaDoServiceWorker(comAssetNovo).STATIC_ASSETS).toContain(
            '/js/asset-inventado-neste-teste.js'
        );

        const fonteDoScript = fs.readFileSync(SCRIPT, 'utf8');
        expect(fonteDoScript).not.toContain("'/js/auth.js'"); // nada de lista duplicada
    });

    test('todo asset local de STATIC_ASSETS existe no repositório', () => {
        const { STATIC_ASSETS } = lerListaDoServiceWorker(fonteSw);

        const ausentes = STATIC_ASSETS.map((url) => url.split('?')[0])
            .map((url) => (url === '/' ? 'index.html' : url.replace(/^\//, '')))
            .filter((rel) => !fs.existsSync(path.join(RAIZ, rel)));

        expect(ausentes).toEqual([]);
    });

    test('reprova um asset alterado sem bump e aprova com bump', () => {
        // Repositório de mentira: dois commits sobre um clone raso do que
        // interessa, para exercitar o script de ponta a ponta sem tocar no
        // repositório de verdade.
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bump-sw-'));
        const git = (...args) => execFileSync('git', args, { cwd: tmp, encoding: 'utf8' });

        try {
            git('init', '-q', '-b', 'base');
            git('config', 'user.email', 'teste@exemplo');
            git('config', 'user.name', 'Teste');
            fs.mkdirSync(path.join(tmp, 'js'), { recursive: true });
            fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
            fs.writeFileSync(path.join(tmp, 'service-worker.js'), fonteSw);
            fs.writeFileSync(path.join(tmp, 'js', 'auth.js'), '// original\n');
            fs.copyFileSync(SCRIPT, path.join(tmp, 'scripts', 'verificar-bump-sw.js'));
            git('add', '.');
            git('commit', '-qm', 'base');
            const base = git('rev-parse', 'HEAD').trim();

            const rodar = () => {
                try {
                    execFileSync(
                        process.execPath,
                        ['scripts/verificar-bump-sw.js', '--base', base],
                        { cwd: tmp, encoding: 'utf8', stdio: 'pipe' }
                    );
                    return 0;
                } catch (e) {
                    return e.status;
                }
            };

            fs.writeFileSync(path.join(tmp, 'js', 'auth.js'), '// mexido\n');
            git('add', '.');
            git('commit', '-qm', 'mexe no asset sem bump');
            expect(rodar()).toBe(1);

            const versaoAtual = lerListaDoServiceWorker(fonteSw).VERSION;
            fs.writeFileSync(
                path.join(tmp, 'service-worker.js'),
                fonteSw.replace(`const VERSION = '${versaoAtual}'`, "const VERSION = 'vTESTE'")
            );
            git('add', '.');
            git('commit', '-qm', 'agora com bump');
            expect(rodar()).toBe(0);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});
