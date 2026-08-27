/**
 * conversas.js — página dedicada de conversas (Issue #71).
 *
 * O QUE ESTA TELA É, E O QUE ELA NÃO É
 * ------------------------------------
 * Ela é a COLUNA DA ESQUERDA de um mensageiro: a lista de quem a pessoa pode
 * alcançar, com presença e pendências. Quem desenha a conversa em si continua
 * sendo `js/chat-direto-manager.js` — 2200 linhas que já resolvem anexo, áudio,
 * reação, resposta, edição, busca no histórico e sincronização por socket.
 *
 * Reescrever aquilo para "ficar do jeito do WhatsApp Web" produziria duas
 * implementações da mesma conversa, que divergem na primeira correção feita
 * num lado só. Em vez disso, a página fornece o elemento
 * `#chatWindowsContainer` que o manager procura, e o CSS ancora a janela no
 * painel da direita. O manager não sabe que está numa página diferente.
 *
 * A LISTA VEM DO SERVIDOR JÁ FILTRADA
 * -----------------------------------
 * `GET /api/chat-direto/contatos` (Issue #69) devolve só quem esta pessoa pode
 * alcançar. Esta tela não decide permissão e não deve tentar: para um
 * responsável, listar a escola inteira e esconder no CSS entregaria no HTML os
 * nomes de todos os professores e famílias.
 */
(function () {
    'use strict';

    const API = () => (window.API_BASE_URL || '/api').replace(/\/$/, '');

    /** Recarrega a lista no máximo a cada 15s quando chega mensagem nova. */
    const INTERVALO_MINIMO_RECARGA = 15000;

    const els = {
        lista: document.getElementById('convLista'),
        busca: document.getElementById('convBusca'),
        vazio: document.getElementById('convVazio'),
        // Só a versão compartilhada da tela marca o link (data-voltar-perfil).
        // A da direção volta para o painel da direção e não tem o atributo.
        voltar: document.querySelector('.conv-voltar[data-voltar-perfil]'),
    };

    let contatos = [];
    let idAberto = null;
    let ultimaRecarga = 0;

    /** Iniciais para o avatar sem foto: "Maria Silva" → "MS". */
    function iniciais(nome) {
        const partes = String(nome || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
        if (!partes.length) return '?';
        const primeira = partes[0][0] || '';
        const ultima = partes.length > 1 ? partes[partes.length - 1][0] : '';
        return (primeira + ultima).toUpperCase();
    }

    const ROTULO_DO_PERFIL = {
        professor: 'Professor',
        diretor: 'Direção',
        secretaria: 'Secretaria',
        responsavel: 'Responsável',
    };

    /**
     * Monta um item da lista.
     *
     * Tudo que vem do servidor entra por `textContent`, nunca por `innerHTML`:
     * nome de pessoa é dado digitado por gente, e um nome com `<` viraria
     * marcação. A única exceção é o ícone, que é literal do código.
     */
    function criarItem(contato) {
        const li = document.createElement('li');

        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'conv-item';
        botao.dataset.id = contato.id;
        if (contato.id === idAberto) botao.setAttribute('aria-current', 'true');

        const avatar = document.createElement('div');
        avatar.className = 'conv-avatar';
        if (contato.foto) {
            const img = document.createElement('img');
            img.src = contato.foto;
            img.alt = '';
            // Foto quebrada cairia num quadrado vazio; as iniciais assumem.
            img.addEventListener('error', () => {
                img.remove();
                avatar.textContent = iniciais(contato.nome);
            });
            avatar.appendChild(img);
        } else {
            avatar.textContent = iniciais(contato.nome);
        }

        const dot = document.createElement('span');
        dot.className = 'conv-status-dot';
        dot.dataset.status = contato.presenca?.status || 'offline';
        avatar.appendChild(dot);

        const texto = document.createElement('div');
        texto.className = 'conv-texto';

        const nome = document.createElement('span');
        nome.className = 'conv-nome';
        nome.textContent = contato.nome || 'Sem nome';

        const sub = document.createElement('span');
        sub.className = 'conv-sub';
        const cargo = ROTULO_DO_PERFIL[contato.perfil] || contato.perfil || '';
        // O texto de presença já vem pronto do servidor (Issue #70), no fuso
        // da escola. Formatar aqui daria um resultado diferente para quem
        // estivesse com o relógio do computador em outro fuso.
        const presenca = contato.presenca?.texto || '';
        sub.textContent = [cargo, presenca].filter(Boolean).join(' · ');

        texto.append(nome, sub);
        botao.append(avatar, texto);

        if (contato.naoLidas > 0) {
            const badge = document.createElement('span');
            badge.className = 'conv-badge';
            badge.textContent = contato.naoLidas > 99 ? '99+' : String(contato.naoLidas);
            // O número sozinho ("3") não diz nada em leitor de tela.
            badge.setAttribute('aria-label', `${contato.naoLidas} mensagens não lidas`);
            botao.appendChild(badge);
        }

        li.appendChild(botao);
        return li;
    }

    function mostrarAviso(icone, mensagem) {
        els.lista.replaceChildren();
        const li = document.createElement('li');
        li.className = 'conv-aviso';
        const i = document.createElement('i');
        i.className = `bi ${icone}`;
        i.setAttribute('aria-hidden', 'true');
        const p = document.createElement('p');
        p.style.margin = '0';
        p.textContent = mensagem;
        li.append(i, p);
        els.lista.appendChild(li);
    }

    function renderizar() {
        const termo = (els.busca.value || '').trim().toLowerCase();
        const visiveis = termo
            ? contatos.filter((c) =>
                  String(c.nome || '')
                      .toLowerCase()
                      .includes(termo)
              )
            : contatos;

        els.lista.setAttribute('aria-busy', 'false');

        if (!contatos.length) {
            mostrarAviso(
                'bi-people',
                'Nenhum contato disponível ainda. A direção da escola pode ajudar.'
            );
            return;
        }
        if (!visiveis.length) {
            mostrarAviso('bi-search', `Ninguém encontrado para "${termo}".`);
            return;
        }

        els.lista.replaceChildren(...visiveis.map(criarItem));

        // js/motion.js revela os itens em cascata. Se ele não estiver
        // carregado a lista simplesmente aparece — a tela nunca depende da
        // animação para ficar legível.
        if (window.Motion && typeof window.Motion.reveal === 'function') {
            window.Motion.reveal(els.lista);
        }
    }

    async function carregar({ silencioso = false } = {}) {
        if (!silencioso) els.lista.setAttribute('aria-busy', 'true');
        ultimaRecarga = Date.now();

        try {
            const res = await fetch(`${API()}/chat-direto/contatos`, {
                credentials: 'include',
                headers: { Accept: 'application/json' },
            });

            if (res.status === 401) {
                window.location.href = 'login.html';
                return;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const corpo = await res.json();
            contatos = Array.isArray(corpo.data) ? corpo.data : [];
            els.busca.disabled = false;
            renderizar();
        } catch (erro) {
            // A tela não fica em branco nem mente dizendo "nenhum contato":
            // falha de rede e lista vazia são coisas diferentes para quem usa.
            console.error('[conversas] falha ao carregar contatos', erro);
            els.lista.setAttribute('aria-busy', 'false');
            mostrarAviso(
                'bi-wifi-off',
                'Não foi possível carregar seus contatos. Tente recarregar a página.'
            );
        }
    }

    function abrir(id) {
        const contato = contatos.find((c) => c.id === id);
        if (!contato) return;

        if (typeof window.abrirChatCom !== 'function') {
            console.error('[conversas] chat-direto-manager.js não carregou');
            return;
        }

        idAberto = id;
        window.abrirChatCom(id, {
            nome: contato.nome,
            foto: contato.foto,
            status: contato.presenca?.status,
        });

        // O painel da direita passa a ter a conversa; o convite some.
        if (els.vazio) els.vazio.style.display = 'none';

        // Abrir a conversa zera o badge no servidor (o manager marca como
        // lida), então o espelho local acompanha em vez de esperar a próxima
        // recarga mostrar um número que já não existe.
        contato.naoLidas = 0;
        renderizar();
    }

    /**
     * Recarga com freio, para os casos em que o evento não basta.
     *
     * Numa escola movimentada refazer a lista a cada evento seria uma
     * requisição por mensagem. Os dois eventos abaixo trazem o suficiente para
     * atualizar em memória; a recarga fica só para o que eles não dizem.
     */
    function recarregarComFreio() {
        if (Date.now() - ultimaRecarga < INTERVALO_MINIMO_RECARGA) return;
        carregar({ silencioso: true });
    }

    /** Mensagem nova para mim soma no badge daquele contato, sem ir ao servidor. */
    function aoChegarMensagem(msg) {
        const remetenteId = String(msg?.remetenteId || '');
        const contato = contatos.find((c) => c.id === remetenteId);
        if (!contato) return;

        // Conversa aberta na tela já é lida pelo próprio manager; somar aqui
        // mostraria uma pendência que não existe.
        if (remetenteId === idAberto) return;

        contato.naoLidas = (contato.naoLidas || 0) + 1;
        renderizar();
    }

    /**
     * `presence:professor` carrega `{userId, online, status}` — o bastante para
     * acender a bolinha na hora.
     *
     * Ficar ONLINE resolve o texto sozinho: é literalmente "online". Ficar
     * OFFLINE não, porque o texto vira "visto por último ..." e só o servidor
     * sabe o horário no fuso da escola (Issue #70). Nesse caso o freio busca a
     * lista de novo em vez de esta tela inventar um horário.
     */
    function aoMudarPresenca(evento) {
        const contato = contatos.find((c) => c.id === String(evento?.userId || ''));
        if (!contato) return;

        const status = evento?.status || (evento?.online ? 'online' : 'offline');
        contato.presenca = contato.presenca || {};
        contato.presenca.status = status;

        if (status === 'offline') {
            recarregarComFreio();
            return;
        }
        contato.presenca.texto = status === 'ausente' ? 'ausente' : 'online';
        renderizar();
    }

    /**
     * "Você leu esta conversa" — emitido para todas as MINHAS abas quando
     * qualquer uma delas abre a conversa.
     *
     * Sem isto, ler numa aba deixava o contato marcado como pendente nas
     * outras: `abrir()` só zera na aba que abriu. O evento traz o id do outro
     * lado, então dá para zerar exatamente aquele contato sem ir ao servidor.
     *
     * NÃO é `chat:lidas`: aquele significa "o outro leu as minhas mensagens" e
     * nem chega para quem leu.
     */
    function aoLerConversa(evento) {
        const contato = contatos.find((c) => c.id === String(evento?.comUsuarioId || ''));
        if (!contato || !contato.naoLidas) return;
        contato.naoLidas = 0;
        renderizar();
    }

    function ligarSocket() {
        if (!window.socket || typeof window.socket.on !== 'function') return false;
        window.socket.on('chat:mensagem', aoChegarMensagem);
        window.socket.on('presence:professor', aoMudarPresenca);
        window.socket.on('chat:conversa-lida', aoLerConversa);
        return true;
    }

    // ── Para onde o "voltar" leva ────────────────────────────────────────
    //
    // Esta tela é compartilhada por TODOS os perfis — é o único ponto do
    // sistema em HTML puro que o responsável alcança, vindo do portal
    // (portal-responsavel/src/components/Header.tsx). O link de voltar era fixo
    // em `dashboard.html`, então o responsável clicava em "voltar" e caía no
    // painel do professor, sem nada na tela que o trouxesse de volta ao portal.
    //
    // O mapa espelha `backend/src/utils/painelPorPerfil.js`, que é quem decide
    // o destino pós-login e quem pode abrir cada painel. Divergir daqui daria
    // um link que abre e imediatamente redireciona.
    const PAINEL_POR_PERFIL = {
        admin: { url: '/html/dashboard.html', rotulo: 'Voltar ao painel' },
        diretor: { url: '/html/dashboard.html', rotulo: 'Voltar ao painel' },
        professor: { url: '/html/dashboard.html', rotulo: 'Voltar ao painel' },
        secretaria: {
            url: '/html/secretaria/painel.html',
            rotulo: 'Voltar ao painel da secretaria',
        },
        responsavel: {
            url: '/portal-responsavel/dist/index.html',
            rotulo: 'Voltar ao portal',
        },
    };

    /**
     * Perfil de quem está usando a tela.
     *
     * O `sessionStorage` é o caminho rápido, mas NÃO dá para depender só dele:
     * o portal do responsável é um app React que autentica por cookie e nunca
     * grava `currentUser`. Quem vem de lá chegaria aqui sem perfil nenhum — que
     * é justamente o caso que este código existe para resolver. Então, sem
     * cache, pergunta ao servidor.
     *
     * Isto é NAVEGAÇÃO, não autorização: o valor só escolhe um href. Quem
     * garante que o responsável não abre o painel do professor é o gate do
     * servidor (middleware/protegerPaginas.js).
     */
    async function meuPerfil() {
        try {
            const cache = JSON.parse(sessionStorage.getItem('currentUser') || 'null');
            if (cache && cache.perfil) return String(cache.perfil).toLowerCase();
        } catch (_e) {
            // Storage desligado ou conteúdo corrompido: segue para a rede.
        }

        try {
            const res = await fetch(`${API()}/auth/me`, {
                credentials: 'include',
                headers: { Accept: 'application/json' },
            });
            if (!res.ok) return '';
            const corpo = await res.json();
            return String(corpo?.user?.perfil || '').toLowerCase();
        } catch (_e) {
            return '';
        }
    }

    /**
     * Aponta o "voltar" para o painel do perfil.
     *
     * Sem perfil resolvido o link fica como está no HTML. Chutar um destino
     * seria pior: o link continua clicável e levaria a pessoa para a tela
     * errada — o servidor a devolveria ao painel certo, mas depois de uma volta
     * de navegação que ela não pediu.
     */
    async function ajustarVoltar() {
        if (!els.voltar) return;

        const destino = PAINEL_POR_PERFIL[await meuPerfil()];
        if (!destino) return;

        els.voltar.href = destino.url;
        els.voltar.setAttribute('aria-label', destino.rotulo);
        els.voltar.title = destino.rotulo;
    }

    function iniciar() {
        if (!els.lista) return;

        els.lista.addEventListener('click', (ev) => {
            const botao = ev.target.closest('.conv-item');
            if (botao?.dataset.id) abrir(botao.dataset.id);
        });

        els.busca.addEventListener('input', renderizar);

        ajustarVoltar();
        carregar();

        // O socket é criado por realtime.js de forma assíncrona (ele injeta o
        // script do socket.io). Tenta agora e, se ainda não existir, volta a
        // tentar por alguns segundos antes de desistir — sem socket a tela
        // continua funcionando, só não atualiza sozinha.
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
