/**
 * @jest-environment jsdom
 */

/**
 * iaEsfera.test.js — o laço de render da esfera do assistente.
 *
 * Não há como afirmar por teste que a esfera está BONITA; isso se vê na tela.
 * O que dá para garantir, e é o que quebra na prática, é que o quadro roda
 * inteiro sem exceção e desenha as camadas que deveria.
 *
 * Isso importa porque `AssistantSphere._quadro` engole as próprias exceções de
 * propósito (uma falha ali não pode derrubar a página do assistente): um erro
 * de digitação no desenho não aparece como tela quebrada, aparece como esfera
 * que some depois de oito quadros e volta para o orb estático em CSS. Este
 * teste é o que transforma esse silêncio em falha de CI.
 *
 * O contexto 2D é um dublê: jsdom não implementa canvas, e o que está sob teste
 * é a SEQUÊNCIA de chamadas de desenho, não os pixels.
 */

const LADO_CSS = 420;

/** Contexto 2D falso que só anota o que foi pedido. */
function criarContextoFalso() {
    return {
        chamadas: { drawImage: 0, stroke: 0, fillRect: 0, gradientes: 0 },
        composicoes: [],
        canvas: null,
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        setTransform() {},
        clearRect() {},
        fillRect() {
            this.chamadas.fillRect += 1;
        },
        drawImage() {
            this.chamadas.drawImage += 1;
            this.composicoes.push(this.globalCompositeOperation);
        },
        beginPath() {},
        ellipse() {},
        stroke() {
            this.chamadas.stroke += 1;
        },
        createRadialGradient() {
            this.chamadas.gradientes += 1;
            return { addColorStop() {} };
        },
    };
}

describe('AssistantSphere', () => {
    let AssistantSphere;
    let contexto;
    let canvas;

    beforeEach(() => {
        jest.resetModules();
        contexto = criarContextoFalso();

        // Todo canvas do documento (o da esfera e os das camadas/sprites
        // pré-renderizadas) devolve o mesmo dublê.
        HTMLCanvasElement.prototype.getContext = jest.fn(() => contexto);

        canvas = document.createElement('canvas');
        canvas.getBoundingClientRect = () => ({
            width: LADO_CSS,
            height: LADO_CSS,
            top: 0,
            left: 0,
            right: LADO_CSS,
            bottom: LADO_CSS,
        });
        document.body.appendChild(canvas);

        AssistantSphere = require('../../../js/ia/AssistantSphere.js').AssistantSphere;
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('desenha um quadro inteiro sem erro, com todas as camadas de luz', () => {
        const esfera = new AssistantSphere(canvas);
        contexto.chamadas.drawImage = 0;
        contexto.composicoes = [];

        esfera._desenhar(1, 1);

        // Fundo + bloom + halo + núcleo + especular + nós dos anéis + a nuvem
        // de pontos: tudo passa por drawImage desde que os gradientes viraram
        // bitmap. Mil é um piso folgado para "a nuvem foi desenhada".
        expect(contexto.chamadas.drawImage).toBeGreaterThan(1000);
        // Os anéis são traçados, não blitados.
        expect(contexto.chamadas.stroke).toBeGreaterThan(0);
        // O primeiro blit do quadro é o fundo em 'copy' — é ele que apaga o
        // quadro anterior. Sem isso a esfera acumularia rastro sobre rastro.
        expect(contexto.composicoes[0]).toBe('copy');
        expect(contexto.composicoes[1]).toBe('lighter');

        esfera.destruir();
    });

    it('não cria gradiente nenhum durante o quadro', () => {
        const esfera = new AssistantSphere(canvas);
        // Os gradientes das camadas e dos sprites são criados UMA vez, na
        // montagem. Voltar a criá-los por quadro foi o custo que abriu espaço
        // para o bloom e o especular; esta é a asserção que segura isso.
        contexto.chamadas.gradientes = 0;

        esfera._desenhar(1, 1);

        expect(contexto.chamadas.gradientes).toBe(0);

        esfera.destruir();
    });

    it('o laço de quadro não deixa exceção escapar nem desistir à toa', () => {
        const esfera = new AssistantSphere(canvas);

        // Vários quadros seguidos, como o rAF faria.
        for (let t = 16; t <= 320; t += 16) esfera._quadro(t);

        expect(esfera.erros).toBe(0);
        expect(esfera.desistiu).toBe(false);

        esfera.destruir();
    });

    it('cada estado desenha, inclusive o de erro, que troca a paleta', () => {
        const esfera = new AssistantSphere(canvas);

        for (const estado of ['ouvindo', 'pensando', 'falando', 'erro', 'ocioso']) {
            esfera.definirEstado(estado);
            contexto.chamadas.drawImage = 0;
            esfera._desenhar(1, 1);
            expect(contexto.chamadas.drawImage).toBeGreaterThan(0);
        }

        expect(esfera.erros).toBe(0);
        esfera.destruir();
    });

    it('a queda de qualidade baixa a densidade antes de descartar pontos', () => {
        const esfera = new AssistantSphere(canvas);
        const dprInicial = esfera.dpr;

        // Simula quadros consistentemente acima do orçamento.
        for (let i = 0; i < 400; i++) esfera._avaliarDesempenho(40);

        expect(esfera.nivelQualidade).toBeGreaterThan(0);
        // O canvas foi remedido no degrau — sem isso o primeiro degrau (que só
        // mexe no dpr) não teria efeito nenhum.
        expect(esfera.dpr).toBeLessThanOrEqual(dprInicial);
        expect(esfera.canvas.width).toBe(Math.round(LADO_CSS * esfera.dpr));

        esfera.destruir();
    });
});
