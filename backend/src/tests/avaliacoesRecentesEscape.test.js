/**
 * @jest-environment jsdom
 */

/**
 * avaliacoesRecentesEscape.test.js — Issue #383
 *
 * A lista "Avaliações recentes" do painel (js/realtime.js) interpolava o nome
 * de quem avaliou o sistema direto no innerHTML. O nome vem do cadastro, que a
 * própria pessoa edita no perfil. Nome, iniciais e tipo agora entram escapados,
 * como o comentário sempre entrou.
 */

const path = require('node:path');

const REALTIME = path.resolve(__dirname, '../../../js/realtime.js');

async function assentar() {
    for (let i = 0; i < 20; i++) {
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
    }
}

beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<div id="reviewStats"></div><div id="reviewList"></div>';
    window.API_BASE_URL = '/api';
});

afterEach(() => {
    delete global.fetch;
    delete window.RealtimeSystem;
});

it('não cria elemento a partir do nome, das iniciais ou do tipo de quem avaliou', async () => {
    global.fetch = jest.fn(() =>
        Promise.resolve({
            ok: true,
            json: () =>
                Promise.resolve({
                    success: true,
                    stats: { average: 5, total: 1, distribution: { 5: 1 } },
                    data: [
                        {
                            userName: '<img src=x onerror=alert(1)> Silva',
                            userType: '"><b id="tipo">x</b>',
                            rating: 5,
                            comment: 'Muito bom',
                        },
                    ],
                }),
        })
    );
    window.fetch = global.fetch;
    require(REALTIME);

    await window.RealtimeSystem.loadReviews();
    await assentar();

    const lista = document.getElementById('reviewList');
    expect(lista.querySelector('.review-item')).not.toBeNull();
    expect(lista.querySelector('img')).toBeNull();
    expect(lista.querySelector('#tipo')).toBeNull();
    expect(lista.querySelector('.review-name').textContent).toBe(
        '<img src=x onerror=alert(1)> Silva'
    );
});
