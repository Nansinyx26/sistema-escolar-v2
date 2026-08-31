/**
 * diagnosticoGemini.test.js — Issue #155
 *
 * O endpoint `/api/ia/gemini-status` já existia e já distinguia cota esgotada
 * de chave recusada; o que faltava era alguém ler essa diferença. Estes testes
 * fixam o veredito de cada ramo, porque a confusão entre dois deles tem custo
 * real: tratar "cota esgotada" como "chave inválida" faz trocar uma chave que
 * estava correta.
 *
 * Os três ramos de falha (401, 403, rede) existem para o contrário: garantir
 * que a tela NÃO emita veredito quando não verificou nada.
 *
 * @jest-environment jsdom
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '../../..');
const { vereditoGemini, consultarGeminiStatus, aplicarVeredito, iniciar } = require(
    path.join(RAIZ, 'js/diagnostico-gemini.js')
);

const ok = (corpo) => ({ status: 200, corpo: { success: true, ...corpo } });

describe('veredito da chave do Gemini (Issue #155)', () => {
    test('chave válida e respondendo: nada a fazer', () => {
        const v = vereditoGemini(ok({ keyConfigured: true, liveOk: true, variavel: 'GEMINI_KEY' }));

        expect(v.estado).toBe('ok');
        expect(v.rotulo).toBe('Ativo');
        expect(v.tom).toBe('sucesso');
        expect(v.detalhe).toContain('GEMINI_KEY');
    });

    test('nenhuma variável publicada: manda publicar E refazer o deploy', () => {
        const v = vereditoGemini(ok({ keyConfigured: false, liveOk: false }));

        expect(v.estado).toBe('ausente');
        expect(v.tom).toBe('erro');
        expect(v.acao).toMatch(/GEMINI_KEY/);
        // Publicar sem redeploy não resolve — a variável só vale no próximo boot.
        expect(v.acao.toUpperCase()).toMatch(/DEPLOY/);
    });

    test('cota esgotada: a chave está CERTA e a instrução é não trocá-la', () => {
        const v = vereditoGemini(
            ok({
                keyConfigured: true,
                liveOk: false,
                quotaExceeded: true,
                message: 'Chave presente, mas o teste falhou: quota exceeded',
            })
        );

        expect(v.estado).toBe('cota');
        expect(v.rotulo).toBe('Sem cota');
        // O ponto inteiro da Issue: este ramo NÃO pode ser lido como chave ruim.
        expect(v.acao).toMatch(/NÃO troque a chave/);
        expect(v.acao).toMatch(/faturamento|virada do dia/);
        expect(v.estado).not.toBe('recusada');
    });

    test('chave presente e recusada: gerar outra e conferir a API habilitada', () => {
        const v = vereditoGemini(
            ok({
                keyConfigured: true,
                liveOk: false,
                quotaExceeded: false,
                message: 'API key not valid',
            })
        );

        expect(v.estado).toBe('recusada');
        expect(v.tom).toBe('erro');
        expect(v.acao).toMatch(/Generative Language/);
        expect(v.acao).not.toMatch(/NÃO troque/);
    });

    test('cota e recusa não colidem: são estados e ações diferentes', () => {
        const base = { keyConfigured: true, liveOk: false };
        const cota = vereditoGemini(ok({ ...base, quotaExceeded: true }));
        const recusada = vereditoGemini(ok({ ...base, quotaExceeded: false }));

        expect(cota.estado).not.toBe(recusada.estado);
        expect(cota.acao).not.toBe(recusada.acao);
    });
});

describe('o que NÃO é veredito sobre a chave (Issue #155)', () => {
    test.each([
        ['401 — sessão expirada', { status: 401 }],
        ['403 — sem permissão', { status: 403 }],
        ['falha de rede', { erroDeRede: true, motivo: 'Failed to fetch' }],
        ['500 sem corpo legível', { status: 500, corpo: null }],
        ['200 com success:false', { status: 200, corpo: { success: false } }],
    ])('%s deixa o veredito indeterminado', (_nome, resposta) => {
        const v = vereditoGemini(resposta);

        expect(v.estado).toBe('indeterminado');
        expect(v.rotulo).toBe('Não verificado');
        expect(v.tom).toBe('neutro');
        // Nenhuma dessas situações pode sugerir troca de chave.
        expect(v.acao).not.toMatch(/troque|Gere uma chave/i);
    });

    test('resposta ausente não quebra nem vira veredito', () => {
        expect(vereditoGemini(undefined).estado).toBe('indeterminado');
    });
});

describe('consulta ao endpoint (Issue #155)', () => {
    test('usa a sessão e a rota do endpoint existente', async () => {
        const fetchFn = jest.fn().mockResolvedValue({
            status: 200,
            json: async () => ({ success: true, keyConfigured: true, liveOk: true }),
        });

        const r = await consultarGeminiStatus(fetchFn, 'https://exemplo/api');

        expect(fetchFn).toHaveBeenCalledWith(
            'https://exemplo/api/ia/gemini-status',
            expect.objectContaining({ credentials: 'include' })
        );
        expect(r.status).toBe(200);
    });

    test('fetch rejeitado vira erroDeRede, não exceção', async () => {
        const fetchFn = jest.fn().mockRejectedValue(new Error('Failed to fetch'));

        await expect(consultarGeminiStatus(fetchFn, '/api')).resolves.toEqual(
            expect.objectContaining({ erroDeRede: true })
        );
    });

    test('corpo ilegível não vira veredito', async () => {
        const fetchFn = jest.fn().mockResolvedValue({
            status: 200,
            json: async () => {
                throw new Error('Unexpected token < in JSON');
            },
        });

        const r = await consultarGeminiStatus(fetchFn, '/api');
        expect(vereditoGemini(r).estado).toBe('indeterminado');
    });
});

describe('renderização do veredito (Issue #155)', () => {
    function montarTela() {
        document.body.innerHTML = `
            <div class="stat-value" id="ia-status" data-tom="neutro">Não verificado</div>
            <button id="btn-testar-gemini" type="button">
                <i class="ti ti-plug-connected"></i>
                <span data-rotulo>Testar chave do Gemini</span>
            </button>
            <div id="gemini-resultado" hidden>
                <strong id="gemini-titulo"></strong>
                <p id="gemini-acao"></p>
                <p id="gemini-detalhe" hidden></p>
            </div>`;

        return {
            cartao: document.getElementById('ia-status'),
            botao: document.getElementById('btn-testar-gemini'),
            painel: document.getElementById('gemini-resultado'),
            titulo: document.getElementById('gemini-titulo'),
            acao: document.getElementById('gemini-acao'),
            detalhe: document.getElementById('gemini-detalhe'),
        };
    }

    test('a mensagem do provedor é inserida como TEXTO, nunca como HTML', () => {
        const elementos = montarTela();
        const hostil = '<img src=x onerror="window.__invadido = true"> falhou';

        aplicarVeredito(
            vereditoGemini(ok({ keyConfigured: true, liveOk: false, message: hostil })),
            elementos
        );

        // A string aparece inteira para quem lê...
        expect(elementos.detalhe.textContent).toContain('<img');
        // ...e nenhum elemento foi criado a partir dela.
        expect(elementos.detalhe.querySelector('img')).toBeNull();
        expect(window.__invadido).toBeUndefined();
    });

    test('o card passa a refletir o veredito em vez de afirmar "Ativo"', () => {
        const elementos = montarTela();

        aplicarVeredito(vereditoGemini(ok({ keyConfigured: false })), elementos);

        expect(elementos.cartao.textContent).toBe('Sem chave');
        expect(elementos.cartao.dataset.tom).toBe('erro');
        expect(elementos.painel.hidden).toBe(false);
    });

    test('estado de carregamento usa skeleton e devolve o rótulo do botão depois', async () => {
        const elementos = montarTela();
        let liberar;
        const fetchFn = jest.fn(
            () =>
                new Promise((resolve) => {
                    liberar = () =>
                        resolve({
                            status: 200,
                            json: async () => ({ success: true, liveOk: true }),
                        });
                })
        );

        iniciar(document, { fetchFn, baseUrl: '/api' });
        elementos.botao.click();

        // Durante a chamada: skeleton no card, botão travado.
        expect(elementos.cartao.classList.contains('skeleton')).toBe(true);
        expect(elementos.botao.disabled).toBe(true);

        liberar();
        await new Promise((r) => setTimeout(r, 0));

        expect(elementos.cartao.classList.contains('skeleton')).toBe(false);
        expect(elementos.botao.disabled).toBe(false);
        // O ícone do botão sobreviveu ao "Testando…".
        expect(elementos.botao.querySelector('i')).not.toBeNull();
        expect(elementos.botao.querySelector('[data-rotulo]').textContent).toBe(
            'Testar chave do Gemini'
        );
    });
});

describe('a página de diagnóstico (Issue #155)', () => {
    const html = fs.readFileSync(path.join(RAIZ, 'html/admin/diagnostico.html'), 'utf8');

    test('o card "Chatbot IA" não afirma mais "Ativo" escrito no HTML', () => {
        const cartao = html.match(/Chatbot IA<\/div>[\s\S]{0,600}?<\/div>/);

        expect(cartao).not.toBeNull();
        expect(cartao[0]).not.toMatch(/>\s*Ativo\s*</);
        expect(cartao[0]).toMatch(/id="ia-status"/);
    });

    test('a página carrega o script do diagnóstico e o api-config que ele usa', () => {
        expect(html).toMatch(/js\/diagnostico-gemini\.js/);
        expect(html).toMatch(/js\/api-config\.js/);
    });

    test('existe o botão que o JS procura', () => {
        expect(html).toMatch(/id="btn-testar-gemini"/);
    });
});
