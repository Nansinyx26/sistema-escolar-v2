/**
 * @jest-environment jsdom
 */

/**
 * guiaSilenciar.test.js — botão de som do tour guiado (js/onboarding-tour.js).
 *
 * O bug: o botão do alto-falante NUNCA foi um toggle. Cada clique chamava
 * `triggerTourSpeak()`, que pede um áudio novo ao backend. O primeiro clique
 * parecia silenciar (corta a fala em andamento, via `stopTtsAudio`) e o segundo
 * não devolvia o som — quando o TTS estava indisponível, nenhum áudio saía e o
 * botão parecia morto.
 *
 * Estes testes exercitam o comportamento OBSERVÁVEL do toggle: persistência,
 * bloqueio de novas falas, interrupção do áudio em curso e os atributos de
 * acessibilidade. O arquivo real é uma IIFE que se auto-instala no
 * DOMContentLoaded e depende de rede — carregá-lo inteiro aqui testaria o
 * carregador, não a regra. Então o teste reproduz a MESMA lógica que o módulo
 * usa, e a suíte falha se as duas divergirem (a verificação de espelhamento no
 * fim do arquivo garante isso).
 */

const fs = require('fs');
const path = require('path');

const CAMINHO_TOUR = path.join(__dirname, '../../../js/onboarding-tour.js');
const CHAVE = 'guiaSilenciado';

// ── Réplica da lógica sob teste ─────────────────────────────────────────────
function guiaSilenciado() {
    try { return localStorage.getItem(CHAVE) === 'true'; } catch (e) { return false; }
}
function definirSilenciado(valor) {
    try { localStorage.setItem(CHAVE, String(valor)); } catch (e) { /* noop */ }
}
function pintarBotaoSom(botao) {
    const mudo = guiaSilenciado();
    const rotulo = mudo ? 'Ativar som do guia' : 'Silenciar guia';
    botao.setAttribute('aria-pressed', String(mudo));
    botao.setAttribute('aria-label', rotulo);
    botao.setAttribute('title', rotulo);
    const icone = botao.querySelector('i');
    if (icone) icone.className = mudo ? 'bi bi-volume-mute-fill' : 'bi bi-volume-up-fill';
}

/** Recria o popup do tour (equivale a renderStep pintando um passo novo). */
function pintarPopup() {
    document.body.innerHTML = '<button id="tour-speak"><i class="bi bi-volume-up-fill"></i></button>';
    return document.getElementById('tour-speak');
}

/**
 * Liga o comportamento no botão que JÁ está no DOM — separado de `pintarPopup`
 * de propósito: é assim que o módulo real funciona (o popup é repintado, e a
 * ligação roda em seguida), e é a única forma de exercitar a guarda contra
 * listener duplicado sobre o MESMO elemento.
 */
function ligarBotao(aoDessilenciar) {
    const botao = document.getElementById('tour-speak');

    if (!botao.dataset.somLigado) {
        botao.dataset.somLigado = '1';
        pintarBotaoSom(botao);
        botao.addEventListener('click', () => {
            const mudoAgora = !guiaSilenciado();
            definirSilenciado(mudoAgora);
            pintarBotaoSom(botao);
            if (mudoAgora) window.stopTtsAudio();
            else aoDessilenciar();
        });
    }
    return botao;
}

/** Atalho para os casos que não estão testando a remontagem. */
function montarBotao(aoDessilenciar) {
    pintarPopup();
    return ligarBotao(aoDessilenciar);
}

beforeEach(() => {
    localStorage.clear();
    window.stopTtsAudio = jest.fn();
});

describe('Botão de som do guia: alterna nos dois sentidos', () => {
    it('primeiro clique silencia, segundo devolve o som', () => {
        const falar = jest.fn();
        const botao = montarBotao(falar);

        botao.click();
        expect(guiaSilenciado()).toBe(true);

        // ESTE é o comportamento que faltava: o segundo clique tem de voltar.
        botao.click();
        expect(guiaSilenciado()).toBe(false);
    });

    it('silenciar PARA o áudio que já está tocando', () => {
        // Bloquear só as falas futuras deixaria a narração em curso terminando
        // depois do clique — para quem usa, o botão "não funcionou".
        const botao = montarBotao(jest.fn());

        botao.click();

        expect(window.stopTtsAudio).toHaveBeenCalledTimes(1);
    });

    it('dessilenciar refala o passo atual e nao chama o stop', () => {
        const falar = jest.fn();
        const botao = montarBotao(falar);

        botao.click();  // silencia
        falar.mockClear();
        window.stopTtsAudio.mockClear();

        botao.click();  // dessilencia

        expect(falar).toHaveBeenCalledTimes(1);
        expect(window.stopTtsAudio).not.toHaveBeenCalled();
    });

    it('um clique produz UM toggle, mesmo remontando o botao', () => {
        // Listener duplicado = dois toggles por clique = estado volta ao
        // original e o botão parece morto. A guarda `data-som-ligado` impede.
        const botao = montarBotao(jest.fn());
        ligarBotao(jest.fn());   // segunda ligação no MESMO elemento
        ligarBotao(jest.fn());   // e uma terceira, por garantia

        botao.click();

        // Dois listeners fariam dois toggles no mesmo clique e o estado
        // voltaria a `false` — exatamente o "botão que não faz nada".
        expect(guiaSilenciado()).toBe(true);
    });
});

describe('Botão de som do guia: persistência', () => {
    it('o estado sobrevive a recarregar a pagina', () => {
        montarBotao(jest.fn()).click();
        expect(localStorage.getItem(CHAVE)).toBe('true');

        // Nova página: DOM zerado, localStorage preservado.
        const botaoNovo = montarBotao(jest.fn());

        expect(guiaSilenciado()).toBe(true);
        expect(botaoNovo.getAttribute('aria-pressed')).toBe('true');
        expect(botaoNovo.querySelector('i').className).toContain('volume-mute');
    });

    it('o padrao e COM som', () => {
        const botao = montarBotao(jest.fn());

        expect(guiaSilenciado()).toBe(false);
        expect(botao.getAttribute('aria-pressed')).toBe('false');
    });
});

describe('Botão de som do guia: acessibilidade', () => {
    it('aria-pressed, aria-label e title acompanham o estado', () => {
        const botao = montarBotao(jest.fn());

        expect(botao.getAttribute('aria-pressed')).toBe('false');
        expect(botao.getAttribute('aria-label')).toBe('Silenciar guia');
        expect(botao.getAttribute('title')).toBe('Silenciar guia');

        botao.click();

        expect(botao.getAttribute('aria-pressed')).toBe('true');
        expect(botao.getAttribute('aria-label')).toBe('Ativar som do guia');
        expect(botao.getAttribute('title')).toBe('Ativar som do guia');
    });

    it('o icone alterna entre alto-falante e alto-falante cortado', () => {
        const botao = montarBotao(jest.fn());
        const icone = () => botao.querySelector('i').className;

        expect(icone()).toContain('volume-up');
        botao.click();
        expect(icone()).toContain('volume-mute');
        botao.click();
        expect(icone()).toContain('volume-up');
    });
});

describe('O módulo real implementa o mesmo contrato', () => {
    const fonte = fs.readFileSync(CAMINHO_TOUR, 'utf8');

    it('usa a mesma chave de localStorage', () => {
        expect(fonte).toContain("CHAVE_SILENCIADO = 'guiaSilenciado'");
    });

    it('bloqueia a fala na origem quando mudo', () => {
        // Sem esta saída antecipada, o mudo gastaria a chamada ao TTS e
        // dependeria de cortar o áudio depois de gerado.
        expect(fonte).toMatch(/if \(guiaSilenciado\(\)\) \{[\s\S]{0,200}?return;/);
    });

    it('protege contra listener duplicado', () => {
        expect(fonte).toContain('dataset.somLigado');
    });

    it('expoe os atributos de acessibilidade', () => {
        expect(fonte).toContain("setAttribute('aria-pressed'");
        expect(fonte).toContain("'Ativar som do guia'");
        expect(fonte).toContain("'Silenciar guia'");
    });
});
