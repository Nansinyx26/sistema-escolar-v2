/**
 * avisoAssistenteDesenvolvimento.test.js — Issue #130
 *
 * `html/direcao/ia-assistant.html` se apresentava como recurso pronto: o
 * cabeçalho trazia só o título e o contexto do perfil. É a única tela do
 * sistema em que o conteúdo é gerado por IA — tratar a saída como informação
 * institucional conferida é risco real para diretor, professor ou secretaria
 * decidindo em cima dela.
 *
 * O que se trava aqui é o que dá para travar sem navegador: presença, papel
 * acessível, o texto, e as regras de estilo que a Issue lista como critério
 * (paleta institucional, nada de `--erro`, animação só de transform/opacity,
 * `prefers-reduced-motion`).
 */
const fs = require('node:fs');
const path = require('node:path');

const PAGINA = path.join(__dirname, '../../..', 'html', 'direcao', 'ia-assistant.html');
const html = fs.readFileSync(PAGINA, 'utf8');

/** O bloco de markup do aviso. */
const marcacao = html.slice(
    html.indexOf('<div class="aviso-desenvolvimento"'),
    html.indexOf('<header class="chat-header">')
);

/** As regras CSS que mencionam o aviso. */
const estilo = html
    .split('\n')
    .filter((linha) => linha.includes('aviso-desenvolvimento'))
    .join('\n');

describe('aviso de recurso em desenvolvimento no Assistente (Issue #130)', () => {
    test('existe e vem antes do cabeçalho do painel de conversa', () => {
        expect(marcacao).toContain('class="aviso-desenvolvimento"');
        expect(html.indexOf('aviso-desenvolvimento" role="note"')).toBeLessThan(
            html.indexOf('<header class="chat-header">')
        );
    });

    test('diz que está em desenvolvimento e que as respostas precisam de conferência', () => {
        expect(marcacao).toMatch(/em desenvolvimento/i);
        expect(marcacao).toMatch(/IA/);
        expect(marcacao).toMatch(/confira/i);
    });

    test('tem papel acessível de nota e não é focável', () => {
        expect(marcacao).toContain('role="note"');
        // `alert`/`status` interromperiam quem chegou para digitar; e nada de
        // tabindex, que colocaria um bloco de texto na ordem de tabulação.
        expect(marcacao).not.toContain('role="alert"');
        expect(marcacao).not.toContain('role="status"');
        expect(marcacao).not.toContain('tabindex');
        expect(marcacao).toContain('aria-hidden="true"'); // o ícone é decorativo
    });

    test('usa os tokens da própria página e nunca --erro', () => {
        expect(estilo).toMatch(/var\(--accent/);
        expect(estilo).not.toMatch(/var\(--erro\)/);
        // Vermelho nesta tela significa falha de geração; isto é informação.
        expect(estilo).not.toMatch(/#f87171/);
    });

    test('a animação é só de opacity/transform e tem duração dentro do teto', () => {
        const keyframes = html.slice(
            html.indexOf('@keyframes aviso-desenvolvimento-entra'),
            html.indexOf('@keyframes aviso-desenvolvimento-entra') + 220
        );

        expect(keyframes).toMatch(/opacity/);
        expect(keyframes).toMatch(/transform/);
        expect(keyframes).not.toMatch(/height|width|top|left|margin/);

        const duracao = estilo.match(/aviso-desenvolvimento-entra (\d+)ms/);
        expect(duracao).not.toBeNull();
        expect(Number(duracao[1])).toBeLessThanOrEqual(180);
    });

    test('respeita prefers-reduced-motion', () => {
        const bloco = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'));
        expect(bloco.slice(0, 400)).toContain('.aviso-desenvolvimento');
    });

    test('continua visível no recorte de celular, onde a .stage some', () => {
        const bloco = html.slice(html.indexOf('@media (max-width: 640px)'));
        const ate = bloco.slice(0, bloco.indexOf('}\n\n'));

        expect(ate).toContain('.aviso-desenvolvimento');
        expect(ate).not.toMatch(/\.aviso-desenvolvimento\s*\{[^}]*display:\s*none/);
    });

    test('reserva espaço para o botão fixo de configurações', () => {
        // O botão do settings-drawer é fixo no canto superior direito e passa
        // por cima de qualquer coisa ali; sem folga, a primeira linha do aviso
        // corre por baixo dele.
        const regra = html.slice(
            html.indexOf('.aviso-desenvolvimento {'),
            html.indexOf('.aviso-desenvolvimento i,')
        );
        expect(regra).toMatch(/padding:\s*9px\s+62px/);

        const noCelular = html.slice(html.indexOf('@media (max-width: 640px)'));
        expect(noCelular.slice(0, 900)).toMatch(/\.aviso-desenvolvimento \{ padding: 9px 56px/);
    });
});
