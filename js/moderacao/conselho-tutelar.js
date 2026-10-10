/**
 * js/moderacao/conselho-tutelar.js — comunicações ao Conselho Tutelar
 * pendentes (Issue #511).
 *
 * A API devolve só metadados: categoria, data e se o caso é sigiloso. Nada de
 * relato nem de quem denunciou. A tela não decide permissão: dispensar a
 * comunicação é só da direção, e quem recusa é o servidor.
 *
 * Motion: skeleton e entrada vêm de css/motion.css via `Motion` (docs/MOTION.md).
 */

(() => {
    'use strict';

    const API = '/api/moderacao';

    const CATEGORIA_ROTULO = {
        violencia: 'Violência',
        assedio: 'Assédio',
        automutilacao: 'Automutilação',
    };

    const MEIOS = [
        ['oficio', 'Ofício'],
        ['email', 'E-mail'],
        ['telefone', 'Telefone'],
        ['presencial', 'Presencial'],
        ['sistema_do_conselho', 'Sistema do Conselho'],
    ];

    const el = {
        lista: document.getElementById('ct-lista'),
        vazio: document.getElementById('ct-vazio'),
        erro: document.getElementById('ct-erro'),
    };
    if (!el.lista) return;

    function escolaDaUrl() {
        const escolaId = new URLSearchParams(location.search).get('escolaId');
        return escolaId ? `?escolaId=${encodeURIComponent(escolaId)}` : '';
    }

    async function pedir(caminho, opcoes = {}) {
        const resposta = await fetch(`${API}${caminho}`, {
            credentials: 'include',
            ...opcoes,
            headers: {
                ...(window.csrfHeaders
                    ? window.csrfHeaders(true)
                    : { 'Content-Type': 'application/json' }),
                ...(opcoes.headers || {}),
            },
        });
        const corpo = await resposta.json().catch(() => ({}));
        if (!resposta.ok) {
            const erro = new Error(corpo.error || 'Falha na requisição.');
            erro.codigo = corpo.codigo;
            throw erro;
        }
        return corpo;
    }

    function mostrarErro(mensagem) {
        el.erro.textContent = mensagem;
        el.erro.hidden = false;
    }

    /** Valor inicial do campo de data: agora, no fuso do navegador. */
    function agoraLocal() {
        const d = new Date();
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        return d.toISOString().slice(0, 16);
    }

    function campo(tipo, rotulo) {
        const input = document.createElement(tipo === 'select' ? 'select' : 'input');
        if (tipo !== 'select') input.type = tipo;
        input.className = 'mod-card__justificativa';
        input.setAttribute('aria-label', rotulo);
        return input;
    }

    function montarCartao(item, indice) {
        const cartao = document.createElement('article');
        // `data-reveal`, e não a classe `motion-reveal` direto: a classe esconde
        // o elemento, e só quem passa por `Motion.reveal` ganha o `is-visible`
        // (Issue #731).
        cartao.className = 'mod-card';
        cartao.setAttribute('data-reveal', '');
        cartao.style.setProperty('--motion-i', String(indice));

        const topo = document.createElement('header');
        topo.className = 'mod-card__topo';
        const selo = document.createElement('span');
        selo.className = 'mod-selo mod-selo--grave';
        selo.textContent = CATEGORIA_ROTULO[item.categoria] || item.categoria || 'Ocorrência';
        const quando = document.createElement('span');
        quando.className = 'mod-card__data';
        quando.textContent =
            item.diasDesdeDenuncia === 0
                ? 'Denunciado hoje'
                : `Denunciado há ${item.diasDesdeDenuncia} dia(s)`;
        topo.append(selo, quando);
        cartao.appendChild(topo);

        if (item.sigilosa) {
            const aviso = document.createElement('p');
            aviso.className = 'mod-card__contestada';
            aviso.textContent = 'Caso sigiloso (Lei 13.819/2019): não comente fora da gestão.';
            cartao.appendChild(aviso);
        }

        const acoes = document.createElement('div');
        acoes.className = 'mod-card__acoes';

        const data = campo('datetime-local', 'Data da comunicação');
        data.value = agoraLocal();
        const meio = campo('select', 'Meio da comunicação');
        for (const [valor, rotulo] of MEIOS) {
            const opcao = document.createElement('option');
            opcao.value = valor;
            opcao.textContent = rotulo;
            meio.appendChild(opcao);
        }
        const protocolo = campo('text', 'Protocolo (opcional)');
        protocolo.placeholder = 'Protocolo (opcional)';
        protocolo.maxLength = 60;

        const comunicar = document.createElement('button');
        comunicar.type = 'button';
        comunicar.className = 'mod-btn mod-btn--aprovar';
        comunicar.textContent = 'Registrar comunicação';
        comunicar.addEventListener('click', () =>
            enviar(item.id, acoes, {
                acao: 'comunicar',
                comunicadoEm: new Date(data.value).toISOString(),
                meio: meio.value,
                protocolo: protocolo.value,
            })
        );

        const justificativa = campo('text', 'Resultado da apuração, se não houver comunicação');
        justificativa.placeholder = 'Resultado da apuração (só para dispensar)';

        const dispensar = document.createElement('button');
        dispensar.type = 'button';
        dispensar.className = 'mod-btn mod-btn--manter';
        dispensar.textContent = 'Dispensar comunicação';
        dispensar.addEventListener('click', () =>
            enviar(item.id, acoes, { acao: 'dispensar', justificativa: justificativa.value })
        );

        acoes.append(data, meio, protocolo, comunicar, justificativa, dispensar);
        cartao.appendChild(acoes);
        return cartao;
    }

    async function enviar(id, container, corpo) {
        el.erro.hidden = true;
        const botoes = container.querySelectorAll('button');
        botoes.forEach((b) => {
            b.disabled = true;
        });
        try {
            await pedir(`/ocorrencia/${encodeURIComponent(id)}/conselho-tutelar${escolaDaUrl()}`, {
                method: 'POST',
                body: JSON.stringify(corpo),
            });
            await carregar();
        } catch (erro) {
            botoes.forEach((b) => {
                b.disabled = false;
            });
            mostrarErro(erro.message);
        }
    }

    async function carregar() {
        el.erro.hidden = true;
        if (window.Motion && typeof window.Motion.skeleton === 'function') {
            window.Motion.skeleton(el.lista, { preset: 'list', count: 2 });
        }
        try {
            const resposta = await pedir(`/conselho-tutelar/pendentes${escolaDaUrl()}`);
            el.lista.replaceChildren();
            el.lista.setAttribute('data-loading', 'false');
            el.lista.setAttribute('aria-busy', 'false');
            const itens = resposta.data || [];
            el.vazio.hidden = itens.length > 0;
            itens.forEach((item, i) => {
                el.lista.appendChild(montarCartao(item, i));
            });
            if (window.Motion && typeof window.Motion.reveal === 'function') {
                window.Motion.reveal(el.lista);
            }
        } catch (erro) {
            el.lista.replaceChildren();
            el.lista.setAttribute('aria-busy', 'false');
            el.vazio.hidden = true;
            mostrarErro(erro.message || 'Não foi possível carregar as comunicações pendentes.');
        }
    }

    document.addEventListener('DOMContentLoaded', carregar);
})();
