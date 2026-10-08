/**
 * coletorErrosFrontSemCsrf.test.js — Issue #715
 *
 * O `js/observability.js` manda o erro do navegador por `sendBeacon`, que não
 * leva cabeçalho — então nunca leva `X-CSRF-Token`. Com o coletor montado
 * depois do `csrfValidator`, todo relatório voltava 403 e o canal de erro do
 * frontend ficava mudo. O coletor agora fica antes do validador, como o
 * relatório de CSP (#613). Aqui o CSRF fica LIGADO, ao contrário do resto da
 * suíte (globalSetup), senão o teste não enxergaria o 403.
 */
const request = require('supertest');
const app = require('../app');
const config = require('../observability/config');
const providers = require('../observability/providers');

const ROTA = '/api/observability/frontend-error';
const relatorio = {
    name: 'TypeError',
    message: 'Cannot set property className of #<SVGElement> which has only a getter',
    pagina: '/html/dashboard.html',
};

let csrfAntes;
let observabilidadeAntes;

beforeAll(() => {
    csrfAntes = process.env.CSRF_DISABLE_FOR_TESTS;
    process.env.CSRF_DISABLE_FOR_TESTS = 'false';
    // Em teste a observabilidade nasce desligada e o coletor só responde 204.
    // Ligada aqui, o relatório chega ao `captureException` (espionado abaixo)
    // e o teto por IP entra em jogo. Nenhum provedor é inicializado.
    observabilidadeAntes = config.disabled;
    config.disabled = false;
});

afterAll(() => {
    process.env.CSRF_DISABLE_FOR_TESTS = csrfAntes;
    config.disabled = observabilidadeAntes;
});

afterEach(() => jest.restoreAllMocks());

it('aceita o relatório sem X-CSRF-Token, como o sendBeacon manda', async () => {
    const captura = jest.spyOn(providers, 'captureException').mockImplementation(() => {});

    const res = await request(app).post(ROTA).send(relatorio);

    expect(res.status).toBe(202);
    expect(captura).toHaveBeenCalledTimes(1);
    const [erro, contexto] = captura.mock.calls[0];
    expect(erro.name).toBe('TypeError');
    expect(contexto).toMatchObject({ origem: 'frontend', pagina: '/html/dashboard.html' });
});

it('o resto de /api continua exigindo o token', async () => {
    const res = await request(app).post('/api/ia/chat').send({ mensagem: 'Oi' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/CSRF/);
});

it('o teto por IP do coletor continua valendo', async () => {
    jest.spyOn(providers, 'captureException').mockImplementation(() => {});

    const status = [];
    for (let i = 0; i < 31; i++) {
        status.push((await request(app).post(ROTA).send(relatorio)).status);
    }

    expect(status).toContain(429);
    expect(status.filter((s) => s !== 202 && s !== 429)).toEqual([]);
});
