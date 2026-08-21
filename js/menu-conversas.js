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

    /**
     * Por quanto tempo o último total conhecido serve para pintar a tela antes
     * da resposta do servidor.
     *
     * Cinco minutos limita o quanto um número velho pode ficar na tela se a
     * rede demorar. Passado isso o selo nasce escondido, que é a leitura menos
     * errada: não mostrar nada é melhor do que afirmar uma pendência que talvez
     * já não exista.
     */
    const VALIDADE_DO_CACHE = 5 * 60 * 1000;

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

    /**
     * Chave do cache, presa ao dono da sessão.
     *
     * Sem o id no nome, sair de uma conta e entrar em outra no mesmo navegador
     * mostraria à segunda pessoa o número da primeira. É pouca informação, mas
     * é informação de outra pessoa — e o conserto custa uma interpolação.
     */
    function chaveDoCache() {
        const meuId = obterMeuId();
        return meuId ? `conversasNaoLidas:${meuId}` : '';
    }

    /**
     * Pinta o último total conhecido antes de a resposta chegar.
     *
     * Sem isto o selo aparecia do nada uns instantes depois da página montar,
     * empurrando o texto do item de menu ao lado — a cada navegação entre
     * telas. O valor é reconciliado pelo `buscar()` que roda logo em seguida.
     */
    function pintarDoCache() {
        const chave = chaveDoCache();
        if (!chave) return;
        try {
            const bruto = sessionStorage.getItem(chave);
            if (!bruto) return;

            const { valor, em } = JSON.parse(bruto);
            if (!em || Date.now() - em > VALIDADE_DO_CACHE) return;

            total = Number(valor) || 0;
            pintar();
        } catch (_e) {
            // Storage indisponível ou conteúdo corrompido: segue sem cache.
        }
    }

    function guardarNoCache() {
        const chave = chaveDoCache();
        if (!chave) return;
        try {
            sessionStorage.setItem(chave, JSON.stringify({ valor: total, em: Date.now() }));
        } catch (_e) {
            // Cota estourada ou storage desligado: o selo funciona sem cache.
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
            guardarNoCache();
        } catch (_erro) {
            // Falha de rede não pode derrubar a barra lateral que hospeda o
            // selo. Fica com o último valor conhecido.
        }
    }

    /**
     * Som de mensagem nova.
     *
     * `js/som-notificacao.js` já sintetiza o som e respeita a preferência
     * `chatSomAtivo` — a MESMA que o botão de mudo dentro da conversa grava.
     * Silenciar num lugar silencia nos dois, que é o que a pessoa espera.
     *
     * O som só toca quando o chat-direto-manager NÃO está na página. Onde ele
     * está (dashboard, painel da direção, a própria tela de conversas) o som já
     * é dele, e tocar aqui também sairia duplicado. Nas telas que só têm o
     * selo — painel da secretaria, gerenciar-secretaria — não há mais ninguém
     * para avisar, e sem isto a mensagem chegaria em silêncio absoluto.
     */
    function tocarSeNinguemMaisAvisa() {
        if (window.chatManager) return;
        window.SomNotificacao?.receber();
    }

    function ligarSocket() {
        if (!window.socket || typeof window.socket.on !== 'function') return false;

        window.socket.on('chat:mensagem', (msg) => {
            // Só conta o que é para mim. O mesmo evento chega para quem enviou.
            const meuId = obterMeuId();
            if (!meuId || String(msg?.destinatarioId || '') !== meuId) return;
            total += 1;
            pintar();
            guardarNoCache();
            tocarSeNinguemMaisAvisa();
        });

        // "Você leu esta conversa", emitido para as MINHAS abas quando qualquer
        // uma delas abre a conversa. Não dá para descontar no cliente — daqui
        // não se sabe quantas das não lidas eram daquele remetente — então
        // relê o total do servidor.
        //
        // NÃO é `chat:lidas`: aquele significa "o outro leu as minhas
        // mensagens" e nem chega para quem leu. Escutá-lo deixava o selo aceso
        // nas outras abas até a revalidação de 60s.
        window.socket.on('chat:conversa-lida', buscar);
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

        pintarDoCache();
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
