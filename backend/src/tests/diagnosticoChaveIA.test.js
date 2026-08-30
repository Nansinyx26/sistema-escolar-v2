/**
 * @jest-environment jsdom
 */

/**
 * diagnosticoChaveIA.test.js — o teste da chave do provedor na página de
 * diagnóstico (`html/admin/diagnostico.html`).
 *
 * O valor desta tela está inteiro no VEREDITO que ela dá: quem abre o
 * diagnóstico vai agir com base no que lê ali. Dois erros de leitura custam
 * caro e nenhum dos dois quebra nada visivelmente:
 *
 *   - dizer "chave inválida" quando o que acabou foi a COTA faz trocar uma
 *     chave que estava correta;
 *   - repassar a mensagem crua do provedor como HTML transforma a resposta de
 *     um serviço externo em marcação executada nesta página.
 *
 * O script embutido é extraído do próprio HTML e executado — assim o teste
 * exercita o código que vai para produção, e não uma cópia dele.
 */

const fs = require('node:fs');
const path = require('node:path');

const ARQUIVO = path.join(__dirname, '..', '..', '..', 'html', 'admin', 'diagnostico.html');
const html = fs.readFileSync(ARQUIVO, 'utf8');

/** O bloco embutido que implementa o teste da chave. */
const SCRIPT = (() => {
    const blocos = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
    const alvo = blocos.find((b) => b.includes('testarGemini'));
    if (!alvo) throw new Error('Script do teste da chave não encontrado no HTML.');
    return alvo.replace(/^<script>/, '').replace(/<\/script>$/, '');
})();

/** Monta a página sem nenhum <script> e roda só o bloco de interesse. */
function montarPagina(respostaDoTeste) {
    document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');

    global.fetch = jest.fn((url) => {
        // `checkApi()` roda sozinho ao carregar; só o /ia/gemini-status importa.
        if (String(url).includes('gemini-status')) return Promise.resolve(respostaDoTeste);
        return Promise.resolve({ ok: true, status: 200 });
    });

    // eslint-disable-next-line no-new-func
    new Function(SCRIPT)();
}

/** Resposta 200 com corpo JSON, como o endpoint devolve. */
function corpo(json) {
    return { ok: true, status: 200, json: () => Promise.resolve(json) };
}

/** Clica e espera o ciclo assíncrono do handler terminar. */
async function clicar() {
    document.getElementById('btnGemini').click();
    // Duas voltas: uma para o `await fetch`, outra para o `await res.json()`.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

const caixa = () => document.getElementById('geminiResultado');
const card = () => document.getElementById('ia-status');

afterEach(() => {
    delete global.fetch;
});

describe('Diagnóstico — teste da chave do provedor de IA', () => {
    it('o card de status não afirma nada antes de alguém testar', () => {
        montarPagina(corpo({}));
        expect(card().textContent).toBe('Não verificado');
        expect(caixa().hidden).toBe(true);
    });

    it('chave válida e respondendo: diz que está ativo e cita a variável em uso', async () => {
        montarPagina(
            corpo({
                success: true,
                keyConfigured: true,
                variavel: 'GEMINI_KEY',
                liveOk: true,
            })
        );
        await clicar();

        expect(caixa().hidden).toBe(false);
        expect(caixa().className).toContain('resultado-ok');
        expect(caixa().textContent).toContain('Chave válida e respondendo');
        expect(caixa().textContent).toContain('GEMINI_KEY');
        expect(card().textContent).toBe('Ativo');
    });

    it('cota esgotada NÃO é reportada como chave errada', async () => {
        montarPagina(
            corpo({
                success: true,
                keyConfigured: true,
                variavel: 'GEMINI_KEY',
                liveOk: false,
                quotaExceeded: true,
                message: 'Chave presente, mas o teste falhou: quota exceeded',
            })
        );
        await clicar();

        const texto = caixa().textContent;
        expect(caixa().className).toContain('resultado-aviso');
        expect(texto).toContain('cota esgotada');
        // A instrução explícita de NÃO trocar a chave é o ponto da tela.
        expect(texto).toContain('Não troque a chave');
        expect(texto).not.toMatch(/inválida|recusada/i);
        expect(card().textContent).toBe('Sem cota');
    });

    it('nenhuma variável publicada: manda publicar e lembra do redeploy', async () => {
        montarPagina(corpo({ success: true, keyConfigured: false, liveOk: false }));
        await clicar();

        const texto = caixa().textContent;
        expect(caixa().className).toContain('resultado-erro');
        expect(texto).toContain('Nenhuma chave configurada');
        expect(texto).toContain('GEMINI_KEY');
        // Sem o redeploy a variável publicada não vale — é a pegadinha do Render.
        expect(texto).toContain('deploy');
        expect(card().textContent).toBe('Sem chave');
    });

    it('chave presente e recusada é distinguida de chave ausente', async () => {
        montarPagina(
            corpo({
                success: true,
                keyConfigured: true,
                variavel: 'GEMINI_KEY',
                liveOk: false,
                message: 'API key not valid',
            })
        );
        await clicar();

        expect(caixa().className).toContain('resultado-erro');
        expect(caixa().textContent).toContain('recusada');
        expect(card().textContent).toBe('Com falha');
    });

    it('a mensagem do provedor entra como texto, nunca como HTML', async () => {
        montarPagina(
            corpo({
                success: true,
                keyConfigured: true,
                liveOk: false,
                message: '<img src=x onerror="window.__invadido = true">',
            })
        );
        await clicar();

        expect(caixa().querySelector('img')).toBeNull();
        expect(window.__invadido).toBeUndefined();
        expect(caixa().textContent).toContain('<img src=x');
    });

    it('sessão expirada e falta de permissão não viram diagnóstico de chave', async () => {
        montarPagina({ ok: false, status: 401 });
        await clicar();
        expect(caixa().textContent).toContain('Sessão expirada');
        // Nada foi provado sobre a chave, então o card não pode mudar de ideia.
        expect(card().textContent).toBe('Não verificado');

        montarPagina({ ok: false, status: 403 });
        await clicar();
        expect(caixa().textContent).toContain('Sem permissão');
        expect(card().textContent).toBe('Não verificado');
    });

    it('servidor fora do ar deixa o veredito indeterminado, não negativo', async () => {
        montarPagina(corpo({}));
        // Trocado DEPOIS de montar: `checkApi()` já rodou, e o que interessa
        // aqui é o /ia/gemini-status falhar na hora do clique.
        global.fetch = jest.fn((url) =>
            String(url).includes('gemini-status')
                ? Promise.reject(new Error('falha de rede'))
                : Promise.resolve({ ok: true, status: 200 })
        );
        await clicar();

        expect(caixa().textContent).toContain('Não foi possível falar com o servidor');
        expect(card().textContent).toBe('Indeterminado');
    });

    it('manda o cookie de sessão — sem ele a rota responde 401 e o teste mente', async () => {
        montarPagina(corpo({ success: true, keyConfigured: true, liveOk: true }));
        await clicar();

        const chamada = global.fetch.mock.calls.find((c) => String(c[0]).includes('gemini-status'));
        expect(chamada[0]).toContain('/ia/gemini-status');
        expect(chamada[1]).toMatchObject({ credentials: 'include' });
    });
});
