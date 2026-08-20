/**
 * menu-conversas.js — o selo de mensagens não lidas na barra lateral (#72).
 *
 * POR QUE UM ARQUIVO SÓ PARA ISSO
 * -------------------------------
 * A entrada "Conversas" aparece em quatro barras laterais diferentes
 * (dashboard, painel da secretaria e as duas telas da direção). Cada uma é um
 * HTML separado, sem componentização. Repetir o script em quatro lugares
 * garantiria que os quatro divergissem na primeira correção — este arquivo é
 * carregado por todos e cada página só precisa marcar o link.
 *
 * COMO A PÁGINA PARTICIPA
 * -----------------------
 * Basta o link ter `data-conversas-badge`. Nada de id fixo: o mesmo script
 * serve barras com marcação diferente, e uma página que esqueça o atributo
 * simplesmente não mostra o selo — em vez de quebrar.
 *
 * O NÚMERO VEM DE UM CONTADOR PRÓPRIO
 * -----------------------------------
 * `GET /chat-direto/nao-lidas` é um `countDocuments` indexado. Reusar
 * `/chat-direto/contatos` e somar daria o mesmo valor, mas aquele endpoint
 * consulta quatro coleções para montar a lista — caro demais para rodar em
 * toda página de todo perfil só para preencher um número.
 */
(function () {
    'use strict';

    const API = () => (window.API_BASE_URL || '/api').replace(/\/$/, '');

    /**
     * Relê a contagem a cada 60s.
     *
     * Existe como rede de segurança, não como mecanismo principal: quem
     * atualiza o selo na hora é o evento `chat:mensagem` do socket. O intervalo
     * cobre a aba que ficou aberta enquanto o socket caiu.
     */
    const INTERVALO_REVALIDACAO = 60000;

    let total = 0;

    function alvos() {
        return document.querySelectorAll('[data-conversas-badge]');
    }

    /** Cria ou reaproveita o selo dentro do link. */
    function selo(link) {
        let el = link.querySelector('.conversas-badge');
        if (!el) {
            el = document.createElement('span');
            el.className = 'conversas-badge';
            link.appendChild(el);
        }
        return el;
    }

    function pintar() {
        for (const link of alvos()) {
            const el = selo(link);
            if (total > 0) {
                el.textContent = total > 99 ? '99+' : String(total);
                // O número sozinho não diz nada em leitor de tela, e o link já
                // se chama "Conversas" — o rótulo completa a frase.
                el.setAttribute('aria-label', `${total} mensagens não lidas`);
                el.hidden = false;
            } else {
                // `hidden` em vez de remover: o elemento volta sem recriar nada
                // quando chegar a próxima mensagem.
                el.hidden = true;
                el.removeAttribute('aria-label');
                el.textContent = '';
            }
        }
    }

    async function buscar() {
        try {
            const res = await fetch(`${API()}/chat-direto/nao-lidas`, {
                credentials: 'include',
                headers: { Accept: 'application/json' },
            });
            // 401 aqui é rotina: a página pode carregar antes da sessão
            // resolver. Some com o selo e espera a próxima volta, sem redirecionar
            // — quem manda na navegação é a página, não o selo dela.
            if (!res.ok) return;

            const corpo = await res.json();
            total = Number(corpo?.data?.total) || 0;
            pintar();
        } catch (_erro) {
            // Falha de rede não pode derrubar a barra lateral que hospeda o
            // selo. Fica com o último valor conhecido.
        }
    }

    function ligarSocket() {
        if (!window.socket || typeof window.socket.on !== 'function') return false;

        window.socket.on('chat:mensagem', (msg) => {
            // Só conta o que é para mim. O mesmo evento chega para quem enviou.
            const meuId = obterMeuId();
            if (!meuId || String(msg?.destinatarioId || '') !== meuId) return;
            total += 1;
            pintar();
        });

        // Ler a conversa muda o total de forma que o cliente não sabe calcular
        // (quantas eram daquele remetente), então relê do servidor.
        window.socket.on('chat:lidas', buscar);
        return true;
    }

    function obterMeuId() {
        try {
            const user =
                (window.auth && window.auth.getCurrentUser && window.auth.getCurrentUser()) ||
                JSON.parse(sessionStorage.getItem('currentUser') || '{}');
            return String(user.id || user._id || '');
        } catch (_e) {
            return '';
        }
    }

    function iniciar() {
        if (!alvos().length) return; // página sem entrada de Conversas

        buscar();
        setInterval(buscar, INTERVALO_REVALIDACAO);

        // realtime.js injeta o socket.io de forma assíncrona; tenta por alguns
        // segundos e desiste. Sem socket o selo continua certo, só que no ritmo
        // da revalidação.
        if (!ligarSocket()) {
            let tentativas = 0;
            const timer = setInterval(() => {
                if (ligarSocket() || ++tentativas > 20) clearInterval(timer);
            }, 500);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
