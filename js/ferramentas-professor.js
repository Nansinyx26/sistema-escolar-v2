/**
 * js/ferramentas-professor.js — cadeado e "Solicitar autorização" nas
 * ferramentas que dependem da direção (Issue #753, Etapa 5 da #720).
 *
 * A decisão é do servidor: `GET /api/ferramentas/minhas` diz o status de cada
 * ferramenta para quem está logado (`autorizado`, `pendente`, `bloqueado`, ou
 * `livre` para quem não é professor), e a barreira das rotas recusa com 403
 * `FERRAMENTA_NAO_AUTORIZADA` o que não foi liberado. Aqui só se reflete isso
 * na tela:
 *
 *   - todo elemento com `data-ferramenta="<id do catálogo>"` ganha cadeado
 *     enquanto a ferramenta não estiver liberada, e o clique abre o aviso com
 *     o botão de pedido em vez de levar à ferramenta;
 *   - `criarBloqueio()` monta o mesmo aviso dentro de uma tela, para quando a
 *     página recebe o 403 da barreira;
 *   - `ferramentas:atualizadas` (Socket.IO) e a volta à aba relêem o status:
 *     o que a direção liberou abre sem recarregar a página.
 *
 * Sem `/minhas` (fora do ar, sessão caída) nada é trancado aqui — a barreira
 * do servidor continua valendo e a tela mostra o 403 quando ele vier.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.FerramentasProfessor = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
    'use strict';

    const TEXTO_BLOQUEIO = 'Esta ferramenta precisa de autorização da direção.';
    const TEXTO_PENDENTE =
        'Seu pedido está com a direção. Você recebe um aviso quando ela decidir.';
    const TRANCADOS = new Set(['bloqueado', 'pendente']);

    /** id → { id, nome, status } */
    const situacao = new Map();
    let carregou = false;
    let iniciado = false;

    function baseApi() {
        return (typeof window !== 'undefined' && window.API_BASE_URL) || '/api';
    }

    function lerCookie(nome) {
        const partes = `; ${document.cookie}`.split(`; ${nome}=`);
        return partes.length === 2 ? partes.pop().split(';').shift() : '';
    }

    function status(id) {
        return situacao.get(id)?.status || null;
    }

    function nome(id) {
        return situacao.get(id)?.nome || 'Esta ferramenta';
    }

    function trancada(id) {
        return TRANCADOS.has(status(id));
    }

    function avisarMudanca(ferramentaId) {
        document.dispatchEvent(
            new CustomEvent('ferramentas:mudou', {
                detail: { ferramentaId, status: status(ferramentaId) },
            })
        );
    }

    async function carregar() {
        try {
            const res = await fetch(`${baseApi()}/ferramentas/minhas`, {
                credentials: 'include',
            });
            if (!res.ok) return false;
            const json = await res.json();
            if (!json?.success || !Array.isArray(json.data)) return false;
            const mudaram = [];
            for (const f of json.data) {
                const antes = situacao.get(f.id)?.status;
                situacao.set(f.id, { id: f.id, nome: f.nome, status: f.status });
                if (carregou && antes !== f.status) mudaram.push(f.id);
            }
            carregou = true;
            aplicar();
            for (const id of mudaram) avisarMudanca(id);
            return true;
        } catch {
            return false;
        }
    }

    function definirStatus(ferramentaId, novo) {
        const atual = situacao.get(ferramentaId) || { id: ferramentaId };
        situacao.set(ferramentaId, { ...atual, status: novo });
        aplicar();
        avisarMudanca(ferramentaId);
    }

    // ── Cadeado nos atalhos ──────────────────────────────────────────────

    function aplicar(raiz) {
        if (!carregou) return;
        const alvo = raiz || document;
        for (const el of alvo.querySelectorAll('[data-ferramenta]')) {
            const id = el.getAttribute('data-ferramenta');
            const fechado = trancada(id);
            el.classList.toggle('fp-trancada', fechado);
            // Sem `aria-disabled`: o system-global.css tira o clique de tudo
            // que o tem, e o clique aqui é justamente o que abre o pedido.
            if (fechado) {
                el.setAttribute('aria-haspopup', 'dialog');
                el.setAttribute('title', TEXTO_BLOQUEIO);
            } else {
                el.removeAttribute('aria-haspopup');
                el.removeAttribute('title');
            }
            let cadeado = el.querySelector(':scope > .fp-cadeado');
            if (fechado && !cadeado) {
                cadeado = document.createElement('span');
                cadeado.className = 'fp-cadeado';
                cadeado.setAttribute('role', 'img');
                cadeado.setAttribute('aria-label', 'Bloqueada: precisa de autorização da direção');
                cadeado.innerHTML = '<i class="bi bi-lock-fill" aria-hidden="true"></i>';
                el.appendChild(cadeado);
            } else if (!fechado && cadeado) {
                cadeado.remove();
            }
        }
    }

    function interceptarClique(evento) {
        const el = evento.target.closest?.('[data-ferramenta]');
        if (!el) return;
        const id = el.getAttribute('data-ferramenta');
        if (!trancada(id)) return;
        evento.preventDefault();
        evento.stopPropagation();
        abrirAviso(id);
    }

    // ── O aviso com o botão de pedido ────────────────────────────────────

    /**
     * Botão "Solicitar autorização". Com pedido aberto ele já nasce como
     * "Aguardando a direção", desabilitado: o servidor não duplica o pedido,
     * e a tela também não convida a tentar de novo.
     */
    function criarBotaoPedido(ferramentaId, { pendente } = {}) {
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'fp-botao';

        function marcarAguardando() {
            botao.disabled = true;
            botao.classList.add('fp-botao-aguardando');
            botao.innerHTML =
                '<i class="bi bi-hourglass-split" aria-hidden="true"></i> Aguardando a direção';
        }

        if (pendente || status(ferramentaId) === 'pendente') {
            marcarAguardando();
            return botao;
        }

        botao.innerHTML = '<i class="bi bi-send" aria-hidden="true"></i> Solicitar autorização';
        botao.addEventListener('click', async () => {
            botao.disabled = true;
            const resultado = await solicitar(ferramentaId);
            if (resultado.ok) {
                marcarAguardando();
                const texto = botao.parentElement?.querySelector('.fp-texto');
                if (texto) texto.textContent = TEXTO_PENDENTE;
            } else {
                botao.disabled = false;
                const erro = botao.parentElement?.querySelector('.fp-erro');
                if (erro) erro.textContent = resultado.erro;
            }
        });
        return botao;
    }

    /**
     * Bloco com cadeado, texto e botão — o mesmo do aviso, para a página
     * mostrar no lugar do conteúdo quando recebe o 403 da barreira.
     *
     * @param {{id: string, nome?: string}} ferramenta
     * @param {{pendente?: boolean}} [opcoes]
     */
    function criarBloqueio(ferramenta, opcoes = {}) {
        if (ferramenta.nome && !situacao.get(ferramenta.id)?.nome) {
            situacao.set(ferramenta.id, {
                ...(situacao.get(ferramenta.id) || { id: ferramenta.id }),
                nome: ferramenta.nome,
            });
        }
        const pendente = opcoes.pendente || status(ferramenta.id) === 'pendente';
        const bloco = document.createElement('div');
        bloco.className = 'fp-bloqueio';
        bloco.setAttribute('role', 'status');
        bloco.dataset.ferramentaBloqueio = ferramenta.id;

        const icone = document.createElement('span');
        icone.className = 'fp-bloqueio-icone';
        icone.setAttribute('aria-hidden', 'true');
        icone.innerHTML = '<i class="bi bi-lock-fill"></i>';

        const titulo = document.createElement('strong');
        titulo.className = 'fp-titulo';
        titulo.textContent = ferramenta.nome || nome(ferramenta.id);

        const texto = document.createElement('p');
        texto.className = 'fp-texto';
        texto.textContent = pendente ? TEXTO_PENDENTE : TEXTO_BLOQUEIO;

        const erro = document.createElement('p');
        erro.className = 'fp-erro';
        erro.setAttribute('role', 'alert');

        bloco.append(icone, titulo, texto, criarBotaoPedido(ferramenta.id, { pendente }), erro);
        return bloco;
    }

    let dialogo = null;

    function abrirAviso(ferramentaId) {
        if (!dialogo) {
            dialogo = document.createElement('dialog');
            dialogo.className = 'fp-dialogo';
            dialogo.setAttribute('aria-label', 'Ferramenta bloqueada');
            dialogo.addEventListener('click', (e) => {
                // Clique no fundo (fora do cartão) fecha.
                if (e.target === dialogo) dialogo.close();
            });
            document.body.appendChild(dialogo);
        }
        dialogo.innerHTML = '';
        const bloco = criarBloqueio({ id: ferramentaId, nome: nome(ferramentaId) });
        const fechar = document.createElement('button');
        fechar.type = 'button';
        fechar.className = 'fp-fechar';
        fechar.setAttribute('aria-label', 'Fechar');
        fechar.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';
        fechar.addEventListener('click', () => dialogo.close());
        bloco.prepend(fechar);
        dialogo.appendChild(bloco);
        if (typeof dialogo.showModal === 'function') dialogo.showModal();
        else dialogo.setAttribute('open', '');
    }

    // ── Pedido ───────────────────────────────────────────────────────────

    /** @returns {Promise<{ok: boolean, erro?: string}>} */
    async function solicitar(ferramentaId, mensagem) {
        try {
            const res = await fetch(
                `${baseApi()}/ferramentas/${encodeURIComponent(ferramentaId)}/solicitar`,
                {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': lerCookie('csrf_token'),
                    },
                    body: JSON.stringify(mensagem ? { mensagem } : {}),
                }
            );
            const json = await res.json().catch(() => ({}));
            if (json.codigo === 'JA_AUTORIZADO') {
                definirStatus(ferramentaId, 'autorizado');
                return { ok: true };
            }
            if (!res.ok || !json.success) {
                return { ok: false, erro: json.error || 'Não foi possível enviar o pedido agora.' };
            }
            definirStatus(ferramentaId, 'pendente');
            return { ok: true };
        } catch {
            return { ok: false, erro: 'Sem conexão. Tente de novo em instantes.' };
        }
    }

    // ── Tempo real ───────────────────────────────────────────────────────

    const RELEITURA_SEM_SOCKET_MS = 60000;

    function algumaTrancada() {
        for (const f of situacao.values()) if (TRANCADOS.has(f.status)) return true;
        return false;
    }

    function ouvirSocket() {
        let tentativas = 0;
        const timer = setInterval(() => {
            tentativas += 1;
            const socket = typeof window !== 'undefined' ? window.socket : null;
            if (socket && typeof socket.on === 'function') {
                clearInterval(timer);
                socket.on('ferramentas:atualizadas', (dados) => {
                    if (dados?.ferramentaId && dados.status) {
                        definirStatus(dados.ferramentaId, dados.status);
                    }
                });
            } else if (tentativas >= 20) {
                clearInterval(timer);
                // Página sem Socket.IO (o copiloto, Autorizações da turma):
                // enquanto houver ferramenta trancada e a aba estiver à
                // vista, relê o status de minuto em minuto.
                setInterval(() => {
                    if (document.visibilityState === 'visible' && algumaTrancada()) carregar();
                }, RELEITURA_SEM_SOCKET_MS);
            }
        }, 500);
    }

    /**
     * Liga tudo: lê o status, tranca os atalhos, intercepta o clique e ouve as
     * decisões da direção. Chamar mais de uma vez não duplica nada.
     */
    function iniciar() {
        if (iniciado) return carregar();
        iniciado = true;
        document.addEventListener('click', interceptarClique, true);
        // Página sem socket (ou que perdeu a conexão): a decisão aparece
        // quando a pessoa volta para a aba.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') carregar();
        });
        ouvirSocket();
        return carregar();
    }

    // No navegador liga sozinho: basta a página incluir o script. Páginas que
    // reagem ao status (o copiloto) chamam `iniciar()` de novo sem custo extra.
    if (typeof document !== 'undefined' && typeof module === 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => iniciar());
        } else {
            iniciar();
        }
    }

    return {
        iniciar,
        carregar,
        aplicar,
        status,
        trancada,
        solicitar,
        criarBloqueio,
        criarBotaoPedido,
        abrirAviso,
        definirStatus,
        TEXTO_BLOQUEIO,
        TEXTO_PENDENTE,
    };
});
