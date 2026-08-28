/**
 * js/moderacao/painel.js — a fila de revisão humana.
 *
 * O QUE ESTA TELA DELIBERADAMENTE NÃO MOSTRA
 * ==========================================
 * O conteúdo da mensagem. A ocorrência não guarda o texto (§6.1 da
 * ESPEC-MODERACAO-CHAT.md) e a API não o devolve — o painel trabalha com
 * metadados: quem, quando, qual severidade, qual camada disparou. Ver o
 * conteúdo original é abrir a conversa, e isso é outro ato, com outro registro.
 *
 * A tela também não decide permissão. Quem decide é `/api/moderacao/*` com
 * `authorize.estrito` + `filtrarPorEscola`; aqui só se desenha o que a API
 * devolveu. Esconder um botão não protege nada.
 *
 * Motion: tudo vem de css/motion.css (`.skeleton`, `.motion-reveal`, tokens de
 * duração). Nenhuma animação declarada aqui — ver AGENTS.md §8 e docs/MOTION.md.
 */

(() => {
    'use strict';

    const API = '/api/moderacao';

    const SEVERIDADE_ROTULO = {
        critica: 'Crítica',
        grave: 'Grave',
        moderada: 'Moderada',
        leve: 'Leve',
    };

    const CAMADA_ROTULO = {
        lexico: 'Filtro de palavras',
        classificador: 'Classificador de texto',
        imagem_api: 'Análise de imagem',
        denuncia: 'Denúncia de usuário',
    };

    const TIPO_ROTULO = { texto: 'Texto', audio: 'Áudio', imagem: 'Imagem' };

    const el = {
        lista: document.getElementById('mod-lista'),
        vazio: document.getElementById('mod-vazio'),
        erro: document.getElementById('mod-erro'),
        metricas: document.getElementById('mod-metricas'),
        alerta: document.getElementById('mod-alerta'),
    };

    /** `admin` precisa dizer de qual escola está falando (R4/§7.2). */
    function escolaDaUrl() {
        const escolaId = new URLSearchParams(location.search).get('escolaId');
        return escolaId ? `?escolaId=${encodeURIComponent(escolaId)}` : '';
    }

    async function pedir(caminho, opcoes = {}) {
        const resposta = await fetch(`${API}${caminho}`, {
            credentials: 'include',
            ...opcoes,
            headers: {
                // `csrfHeaders(true)` já devolve o Content-Type de JSON junto do
                // X-CSRF-Token — ver js/csrf-helper.js.
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
            erro.status = resposta.status;
            throw erro;
        }
        return corpo;
    }

    function formatarData(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    /**
     * Monta o cartão sem `innerHTML` com dado do servidor.
     *
     * Mesma decisão das telas de conversa: `remetentePerfil`, `termosDetectados`
     * e afins vêm do banco, e um `innerHTML` aqui transformaria conteúdo em
     * marcação. `textContent` fecha essa porta por construção.
     */
    function montarCartao(ocorrencia, indice) {
        const cartao = document.createElement('article');
        cartao.className = 'mod-card motion-reveal';
        cartao.style.setProperty('--motion-i', String(indice));
        cartao.dataset.id = ocorrencia.id;

        const topo = document.createElement('header');
        topo.className = 'mod-card__topo';

        const selo = document.createElement('span');
        selo.className = `mod-selo mod-selo--${ocorrencia.severidade}`;
        selo.textContent = SEVERIDADE_ROTULO[ocorrencia.severidade] || ocorrencia.severidade;
        topo.appendChild(selo);

        const quando = document.createElement('time');
        quando.className = 'mod-card__data';
        quando.dateTime = ocorrencia.criadoEm || '';
        quando.textContent = formatarData(ocorrencia.criadoEm);
        topo.appendChild(quando);

        cartao.appendChild(topo);

        const linhas = [
            ['Origem', CAMADA_ROTULO[ocorrencia.camada] || ocorrencia.camada],
            ['Tipo', TIPO_ROTULO[ocorrencia.tipoConteudo] || ocorrencia.tipoConteudo],
            ['Perfil de quem enviou', ocorrencia.remetentePerfil || '—'],
        ];

        if (Array.isArray(ocorrencia.termosDetectados) && ocorrencia.termosDetectados.length) {
            linhas.push(['Termos detectados', ocorrencia.termosDetectados.join(', ')]);
        }

        const dl = document.createElement('dl');
        dl.className = 'mod-card__dados';
        for (const [rotulo, valor] of linhas) {
            const dt = document.createElement('dt');
            dt.textContent = rotulo;
            const dd = document.createElement('dd');
            dd.textContent = valor;
            dl.append(dt, dd);
        }
        cartao.appendChild(dl);

        if (ocorrencia.contestacao && ocorrencia.contestacao.solicitadoEm) {
            const aviso = document.createElement('p');
            aviso.className = 'mod-card__contestada';
            aviso.textContent = 'Esta decisão foi contestada por quem enviou o conteúdo.';
            cartao.appendChild(aviso);
        }

        cartao.appendChild(montarAcoes(ocorrencia));
        return cartao;
    }

    function montarAcoes(ocorrencia) {
        const acoes = document.createElement('div');
        acoes.className = 'mod-card__acoes';

        const justificativa = document.createElement('input');
        justificativa.type = 'text';
        justificativa.className = 'mod-card__justificativa';
        justificativa.placeholder = 'Justificativa da decisão';
        justificativa.setAttribute('aria-label', 'Justificativa da decisão');
        acoes.appendChild(justificativa);

        const aprovar = document.createElement('button');
        aprovar.type = 'button';
        aprovar.className = 'mod-btn mod-btn--aprovar';
        aprovar.textContent = 'Liberar';
        aprovar.addEventListener('click', () =>
            decidir(ocorrencia.id, 'aprovar', justificativa, acoes)
        );

        const manter = document.createElement('button');
        manter.type = 'button';
        manter.className = 'mod-btn mod-btn--manter';
        manter.textContent = 'Manter bloqueio';
        manter.addEventListener('click', () =>
            decidir(ocorrencia.id, 'manter_bloqueio', justificativa, acoes)
        );

        acoes.append(aprovar, manter);
        return acoes;
    }

    async function decidir(id, decisao, campoJustificativa, container) {
        const justificativa = campoJustificativa.value.trim();

        // A API também exige — a checagem aqui é só para o moderador não perder
        // o clique e receber um erro genérico depois.
        if (justificativa.length < 3) {
            campoJustificativa.focus();
            mostrarErro('Escreva a justificativa antes de decidir.');
            return;
        }

        const botoes = container.querySelectorAll('button');
        botoes.forEach((b) => {
            b.disabled = true;
        });

        try {
            await pedir(`/ocorrencia/${encodeURIComponent(id)}/decidir${escolaDaUrl()}`, {
                method: 'POST',
                body: JSON.stringify({ decisao, justificativa }),
            });
            await carregar();
        } catch (erro) {
            botoes.forEach((b) => {
                b.disabled = false;
            });
            mostrarErro(erro.message);
        }
    }

    function mostrarErro(mensagem) {
        if (!el.erro) return;
        el.erro.textContent = mensagem;
        el.erro.hidden = false;
    }

    function limparErro() {
        if (el.erro) el.erro.hidden = true;
    }

    /**
     * Esqueleto enquanto a fila carrega — obrigatório por docs/MOTION.md.
     *
     * Usa `Motion.skeleton` para o preset e os estados de acessibilidade
     * (`aria-busy`) virem do sistema; não desenhamos skeleton próprio.
     */
    function mostrarEsqueleto() {
        if (!el.lista) return;

        if (window.Motion && typeof window.Motion.skeleton === 'function') {
            window.Motion.skeleton(el.lista, { preset: 'list', count: 3 });
            return;
        }
        el.lista.replaceChildren();
    }

    /**
     * Sai do estado de carregamento.
     *
     * `Motion.ready` recebe HTML em string, e aqui o conteúdo é montado como nó
     * para nunca passar dado do servidor por `innerHTML` — então encerramos os
     * atributos de carregamento à mão e chamamos `reveal` no fim.
     */
    function encerrarEsqueleto() {
        if (!el.lista) return;
        el.lista.replaceChildren();
        el.lista.setAttribute('data-loading', 'false');
        el.lista.setAttribute('aria-busy', 'false');
    }

    function renderarMetricas(dados) {
        if (!el.metricas) return;
        el.metricas.replaceChildren();

        const itens = [
            ['Na fila', dados.pendentes],
            ['Total registrado', dados.total],
            ['Taxa de reversão', `${(dados.taxaReversao * 100).toFixed(1)}%`],
        ];

        for (const [rotulo, valor] of itens) {
            const caixa = document.createElement('div');
            caixa.className = 'mod-metrica';

            const numero = document.createElement('strong');
            numero.textContent = String(valor);
            const texto = document.createElement('span');
            texto.textContent = rotulo;

            caixa.append(numero, texto);
            el.metricas.appendChild(caixa);
        }

        // Os dois alertas operacionais que a spec define (§7.4 e §9.2).
        const avisos = [];
        if (dados.filaAcumulada) avisos.push('A fila passou de 20 itens pendentes.');
        if (dados.limiarMalCalibrado) {
            avisos.push(
                'Mais de 15% das decisões estão sendo revertidas — o limiar pode estar mal calibrado.'
            );
        }

        if (el.alerta) {
            el.alerta.textContent = avisos.join(' ');
            el.alerta.hidden = avisos.length === 0;
        }
    }

    async function carregar() {
        limparErro();
        mostrarEsqueleto();

        try {
            const [fila, metricas] = await Promise.all([
                pedir(`/fila${escolaDaUrl()}`),
                pedir(`/metricas${escolaDaUrl()}`),
            ]);

            renderarMetricas(metricas.data);

            encerrarEsqueleto();
            const ocorrencias = fila.data || [];

            if (el.vazio) el.vazio.hidden = ocorrencias.length > 0;

            ocorrencias.forEach((ocorrencia, i) => {
                el.lista.appendChild(montarCartao(ocorrencia, i));
            });

            // `Motion.reveal` marca os filhos para a entrada animada do sistema
            // e respeita `prefers-reduced-motion` por conta própria.
            if (window.Motion && typeof window.Motion.reveal === 'function') {
                window.Motion.reveal(el.lista);
            }
        } catch (erro) {
            encerrarEsqueleto();
            if (el.vazio) el.vazio.hidden = true;

            if (erro.codigo === 'ESCOLA_NAO_INFORMADA') {
                mostrarErro(
                    'Informe a escola na URL (?escolaId=…) para abrir a fila desta escola.'
                );
                return;
            }
            mostrarErro(erro.message || 'Não foi possível carregar a fila.');
        }
    }

    document.addEventListener('DOMContentLoaded', carregar);
})();
