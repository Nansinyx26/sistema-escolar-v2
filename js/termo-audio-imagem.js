/**
 * js/termo-audio-imagem.js — cláusula 2 do TERMO-DE-USO-AUDIO-IMAGEM.md.
 *
 * "O envio da primeira mensagem de áudio ou imagem no chat só é liberado após o
 * aceite expresso deste Termo, registrado no sistema com data, hora e
 * identificação do usuário."
 *
 * ESTA TELA NÃO É A BARREIRA
 * ==========================
 * Ela desabilita os botões de áudio e anexo até o aceite, o que é uma cortesia
 * de interface: quem chamar `POST /chat-direto/upload` por fora não passa por
 * aqui. A barreira de verdade é do servidor. O que este arquivo garante é que a
 * pessoa VEJA o Termo antes de gravar um áudio, e que o aceite seja um clique
 * deliberado — não um checkbox pré-marcado no rodapé de outra tela.
 *
 * Falha ABERTA de propósito: se a consulta de aceite falhar (rede, servidor
 * fora), os botões continuam como estavam. Trancar o chat da escola porque uma
 * requisição de verificação não voltou seria trocar um problema jurídico por
 * um problema operacional maior.
 */

(() => {
    'use strict';

    const API = '/api/moderacao/aceite-termo';

    /**
     * Os controles que dependem do aceite. Os seletores acompanham o
     * chat-direto-manager; um seletor que não casa com nada simplesmente não
     * trava nada, que é o comportamento seguro aqui.
     */
    const SELETORES_BLOQUEADOS = [
        '[data-acao="gravar-audio"]',
        '[data-acao="anexar"]',
        '.chat-btn-audio',
        '.chat-btn-anexo',
    ];

    let aceito = null;

    function controles() {
        return document.querySelectorAll(SELETORES_BLOQUEADOS.join(', '));
    }

    function aplicarEstado() {
        for (const controle of controles()) {
            if (aceito) {
                controle.removeAttribute('aria-disabled');
                controle.removeAttribute('title');
                controle.classList.remove('esta-bloqueado-pelo-termo');
            } else {
                controle.setAttribute('aria-disabled', 'true');
                controle.setAttribute('title', 'Aceite o Termo de Uso para enviar áudio e imagem.');
                controle.classList.add('esta-bloqueado-pelo-termo');
            }
        }
    }

    async function consultarAceite() {
        try {
            const resposta = await fetch(API, { credentials: 'include' });
            if (!resposta.ok) return null;
            const corpo = await resposta.json();
            return Boolean(corpo?.data?.aceito);
        } catch {
            return null; // falha aberta — ver cabeçalho
        }
    }

    async function registrarAceite() {
        const resposta = await fetch(API, {
            method: 'POST',
            credentials: 'include',
            headers: window.csrfHeaders
                ? window.csrfHeaders(true)
                : { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        if (!resposta.ok) throw new Error('Não foi possível registrar o aceite.');
    }

    /**
     * O modal. Montado por nó, sem `innerHTML`, e com foco preso enquanto
     * estiver aberto — é um diálogo de consentimento, não um toast.
     */
    function abrirModal() {
        const fundo = document.createElement('div');
        fundo.className = 'termo-modal-fundo';
        fundo.setAttribute('role', 'dialog');
        fundo.setAttribute('aria-modal', 'true');
        fundo.setAttribute('aria-labelledby', 'termo-titulo');

        const caixa = document.createElement('div');
        caixa.className = 'termo-modal motion-reveal';

        const titulo = document.createElement('h2');
        titulo.id = 'termo-titulo';
        titulo.textContent = 'Envio de áudio e imagem';

        const texto = document.createElement('p');
        texto.textContent =
            'Para enviar áudios e imagens no chat da escola, é preciso aceitar o Termo de Uso. ' +
            'O conteúdo enviado pode passar por moderação automática e por revisão da equipe ' +
            'da escola quando for sinalizado.';

        const aviso = document.createElement('p');
        aviso.className = 'termo-modal__aviso';
        aviso.textContent =
            'O chat não substitui os canais oficiais da escola para emergências ou denúncias formais.';

        const acoes = document.createElement('div');
        acoes.className = 'termo-modal__acoes';

        const agora_nao = document.createElement('button');
        agora_nao.type = 'button';
        agora_nao.className = 'termo-btn termo-btn--secundario';
        agora_nao.textContent = 'Agora não';

        const aceitar = document.createElement('button');
        aceitar.type = 'button';
        aceitar.className = 'termo-btn termo-btn--principal';
        aceitar.textContent = 'Li e aceito';

        const erro = document.createElement('p');
        erro.className = 'termo-modal__erro';
        erro.setAttribute('role', 'alert');
        erro.hidden = true;

        function fechar() {
            fundo.remove();
            document.removeEventListener('keydown', aoTeclar);
        }

        function aoTeclar(evento) {
            if (evento.key === 'Escape') fechar();
        }

        agora_nao.addEventListener('click', fechar);

        aceitar.addEventListener('click', async () => {
            aceitar.disabled = true;
            erro.hidden = true;
            try {
                await registrarAceite();
                aceito = true;
                aplicarEstado();
                fechar();
            } catch (e) {
                aceitar.disabled = false;
                erro.textContent = e.message;
                erro.hidden = false;
            }
        });

        acoes.append(agora_nao, aceitar);
        caixa.append(titulo, texto, aviso, erro, acoes);
        fundo.appendChild(caixa);
        document.body.appendChild(fundo);

        document.addEventListener('keydown', aoTeclar);
        aceitar.focus();

        if (window.Motion && typeof window.Motion.reveal === 'function') {
            window.Motion.reveal(fundo);
        }
    }

    /**
     * Intercepta o clique nos controles bloqueados na fase de CAPTURA: sem isso,
     * o handler do chat-direto-manager já teria aberto o gravador antes de a
     * pessoa ver o Termo.
     */
    function interceptarCliques() {
        document.addEventListener(
            'click',
            (evento) => {
                if (aceito !== false) return;

                const alvo = evento.target.closest(SELETORES_BLOQUEADOS.join(', '));
                if (!alvo) return;

                evento.preventDefault();
                evento.stopPropagation();
                abrirModal();
            },
            true
        );
    }

    async function iniciar() {
        aceito = await consultarAceite();

        // `null` = não deu para saber. Não trava nada e não incomoda ninguém.
        if (aceito === null) return;

        aplicarEstado();
        interceptarCliques();
    }

    document.addEventListener('DOMContentLoaded', iniciar);
})();
