/**
 * pagina-ia-assistant.js — ponto de entrada da página do copiloto.
 *
 * Só cola as peças: guarda de autenticação, orb/estado visual, painel de voz e
 * o ChatController. Fica em módulo separado (e não em `<script>` inline) porque
 * a CSP desta aplicação autoriza scripts inline por HASH do conteúdo: todo
 * ajuste no HTML forçaria o re-hash, e um deploy com o hash defasado derruba a
 * página inteira. Arquivo externo é coberto por `'self'` e não tem esse risco.
 */

import { AssistantSphere } from './AssistantSphere.js';
import { ChatController, ESTADO_VAZIO_HTML } from './ChatController.js';
import { CommandPalette } from './CommandPalette.js';
import { ConversationSidebar } from './ConversationSidebar.js';
import { criarMedidorDeVoz } from './NivelDeVoz.js';

// ── Toast ────────────────────────────────────────────────────────────────────

let timerToast;
function avisar(mensagem) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = mensagem;
    t.classList.add('show');
    clearTimeout(timerToast);
    timerToast = setTimeout(() => t.classList.remove('show'), 3500);
}

// ── Estado visual do orb ─────────────────────────────────────────────────────

/** Preenchido em `iniciar()`. O painel de preferências precisa dele para
 *  aplicar a narração automática sem esperar um recarregamento. */
let controladorAtivo = null;

const TEXTO_ESTADO = {
    ocioso: 'Pronto para ajudar',
    pensando: 'Pensando...',
    falando: 'Narrando a resposta...',
    ouvindo: 'Ouvindo você...',
    erro: 'Algo deu errado na voz',
};

/** Quanto o estado de erro fica visível antes de voltar ao repouso. */
const MS_ESTADO_ERRO = 5000;

/** @type {AssistantSphere|null} */
let esfera = null;
/** @type {ReturnType<typeof criarMedidorDeVoz>|null} */
let medidor = null;
let timerEstadoErro;

/**
 * @param {'ocioso'|'pensando'|'falando'|'ouvindo'|'erro'} estado
 * @param {string} [mensagem] rótulo alternativo — usado pelo estado de erro,
 *   que mostra a causa real em vez do texto genérico.
 */
function definirEstado(estado, mensagem) {
    const orb = document.getElementById('orb');
    const pilula = document.getElementById('statusPill');
    const barras = document.getElementById('bars');
    const texto = document.getElementById('statusText');
    if (!orb) return;

    clearTimeout(timerEstadoErro);

    const animado = estado === 'pensando' || estado === 'falando' || estado === 'ouvindo';
    orb.className = 'orb' + (animado ? ' ' + estado : '');
    if (pilula) pilula.className = 'status-pill ' + estado;
    if (texto) texto.textContent = mensagem || TEXTO_ESTADO[estado] || estado;
    // As barras representam áudio em movimento — vale tanto para o assistente
    // narrando quanto para o microfone captando a pessoa. Ficam escondidas
    // quando a esfera em canvas assume esse papel (ver .stage.esfera-ativa).
    if (barras)
        barras.className = 'bars' + (estado === 'falando' || estado === 'ouvindo' ? ' active' : '');

    if (esfera) esfera.definirEstado(estado);
    // Fora de "falando" o medidor não tem áudio a acompanhar. Soltar aqui, e
    // não num evento de fim de áudio, cobre também a narração interrompida
    // pelo microfone — que para o som sem disparar `ended`.
    if (estado !== 'falando' && medidor) medidor.soltar();

    // O erro é um aviso, não um estado de trabalho: ele mesmo se retira.
    if (estado === 'erro') {
        timerEstadoErro = setTimeout(() => definirEstado('ocioso'), MS_ESTADO_ERRO);
    }
}

// ── Esfera do assistente ─────────────────────────────────────────────────────

/**
 * Devolve o palco ao orb estático em CSS.
 *
 * É o "error boundary" desta página: chamado quando `AssistantSphere` não sobe,
 * ou quando o laço de render acumula erros e desiste. O orb em CSS nunca sai do
 * documento justamente para poder reaparecer aqui, sem tela em branco.
 */
function reverterParaOrbEstatico() {
    document.getElementById('orbWrap')?.classList.remove('esfera-ativa');
    document.getElementById('stage')?.classList.remove('esfera-ativa');
    // Solta rAF e observadores. `destruir` é idempotente, então também é seguro
    // aqui no caminho em que a própria esfera já desistiu e chamou de volta.
    esfera?.destruir();
    esfera = null;
}

function encerrarEsfera() {
    esfera?.destruir();
    medidor?.destruir();
    esfera = null;
    medidor = null;
}

/**
 * Sobe a esfera em canvas sobre o orb em CSS.
 *
 * Falhar aqui é aceitável e silencioso para quem usa: a página continua
 * inteira com o orb estático. O que não pode acontecer é a exceção subir e
 * interromper `iniciar()`, que ainda tem o chat para montar.
 */
function iniciarEsfera() {
    const canvas = document.getElementById('orbCanvas');
    const wrap = document.getElementById('orbWrap');
    if (!canvas || !wrap) return;

    // As classes entram ANTES de construir: é `.esfera-ativa` que dá ao wrap o
    // tamanho final (--esfera-tam). Medir o canvas antes disso o dimensionaria
    // pelos 160px do orb, e só um ResizeObserver o corrigiria depois — num
    // navegador sem ResizeObserver a esfera ficaria miniatura para sempre.
    wrap.classList.add('esfera-ativa');
    document.getElementById('stage')?.classList.add('esfera-ativa');

    try {
        medidor = criarMedidorDeVoz();
        esfera = new AssistantSphere(canvas, { medidor, aoFalhar: reverterParaOrbEstatico });
    } catch (e) {
        console.error('[IA] Esfera indisponível; seguindo com o orb estático:', e);
        medidor?.destruir();
        medidor = null;
        reverterParaOrbEstatico();
        return;
    }

    // `tts:started` é disparado por sidebar-voice.js depois do play(), com o
    // elemento já em `window.currentTtsAudio`. É o gancho para ligar o
    // analisador ao áudio real — o Blob URL de lá é same-origin, então o
    // espectro vem preenchido em vez de zerado.
    window.addEventListener('tts:started', () => medidor?.observar(window.currentTtsAudio));

    // O AudioContext nasce suspenso e só um gesto do usuário o libera. Um
    // listener `once` no documento cobre qualquer gesto — clicar em enviar,
    // no microfone, na esfera ou digitar.
    const destravar = () => medidor?.desbloquear();
    document.addEventListener('pointerdown', destravar, { once: true, passive: true });
    document.addEventListener('keydown', destravar, { once: true });

    // `pagehide` e não `unload`: com bfcache o `unload` pode nunca rodar, e o
    // rAF continuaria vivo numa página congelada.
    window.addEventListener('pagehide', encerrarEsfera, { once: true });
}

// ── Destino do botão "voltar" ────────────────────────────────────────────────
// A página é compartilhada por vários perfis, então o "voltar" não pode ser
// fixo: apontar sempre para o painel da direção deixava professor e secretaria
// numa parede — link para uma área que eles não acessam.

const PAINEL_POR_PERFIL = {
    admin: { url: '/html/direcao/index.html', rotulo: 'Voltar ao painel de direção' },
    diretor: { url: '/html/direcao/index.html', rotulo: 'Voltar ao painel de direção' },
    secretaria: { url: '/html/secretaria/painel.html', rotulo: 'Voltar ao painel da secretaria' },
    professor: { url: '/html/dashboard.html', rotulo: 'Voltar ao painel' },
    responsavel: { url: '/portal-responsavel/dist/index.html', rotulo: 'Voltar ao portal' },
};

const PAINEL_PADRAO = { url: '/html/dashboard.html', rotulo: 'Voltar ao painel' };

function definirVoltar(perfil) {
    const link = document.getElementById('backBtn');
    if (!link) return;
    const destino = PAINEL_POR_PERFIL[String(perfil || '').toLowerCase()] || PAINEL_PADRAO;
    link.href = destino.url;
    link.title = destino.rotulo;
    link.setAttribute('aria-label', destino.rotulo);
}

/**
 * Perfil conhecido pelo cliente. É só um palpite para a primeira pintura —
 * `sessionStorage` é gravado pelo próprio front e não vale como autorização.
 * O servidor confirma (ou corrige) no evento `inicio` da primeira mensagem.
 */
function perfilProvavel() {
    try {
        return JSON.parse(sessionStorage.getItem('currentUser') || '{}').perfil || '';
    } catch {
        return '';
    }
}

// ── Painel de voz ────────────────────────────────────────────────────────────
// Mantém as MESMAS chaves de localStorage e o mesmo endpoint da versão
// anterior desta página, para não invalidar a preferência de quem já usava.

/** Vozes que o backend sabe resolver. Serve para descartar valor legado. */
const VOZES_VALIDAS = ['adam', 'brian', 'eric', 'george', 'off'];

/**
 * Normaliza a voz salva. Instalações antigas gravaram 'male' (nomenclatura do
 * Google Cloud) em `user_elevenlabs_voice`; sem esta tradução o `<select>` não
 * casava com nenhuma opção e caía silenciosamente na primeira.
 */
function normalizarVoz(valor) {
    const v = String(valor || '').toLowerCase();
    if (VOZES_VALIDAS.includes(v)) return v;
    if (v === 'female' || v === 'male') return 'brian';
    return 'brian';
}

let cfg = {
    voice: normalizarVoz(
        localStorage.getItem('user_elevenlabs_voice') ||
            localStorage.getItem('user_voice_preference')
    ),
    lang: 'pt-BR',
    provider: localStorage.getItem('user_tts_provider') || 'elevenlabs',
    // Narração automática fica LIGADA por padrão NESTA página — e só nela.
    // Aqui a tela inteira é um orb de voz: quem abre o assistente vem para
    // conversar, e uma resposta que só aparece escrita entrega metade do que a
    // página promete. Nas outras telas o áudio continua sendo opt-in.
    //
    // O `!== '0'` (e não `=== '1'`) é o que faz o padrão valer: quem nunca
    // mexeu na preferência não tem a chave gravada, e desligar é uma escolha
    // registrada que continua sendo respeitada em toda visita seguinte.
    narrarAuto: (localStorage.getItem('user_narrar_auto') ?? '1') !== '0',
};

function carregarConfig() {
    try {
        const salvo = JSON.parse(localStorage.getItem('aichat_cfg_local') || '{}');
        cfg = { ...cfg, ...salvo };
    } catch {
        // Preferência corrompida no storage: segue com o padrão.
    }
    cfg.voice = normalizarVoz(cfg.voice);

    const v = document.getElementById('cfgVoice');
    const l = document.getElementById('cfgLang');
    const p = document.getElementById('cfgProvider');
    const a = document.getElementById('cfgAuto');
    if (v) v.value = cfg.voice;
    if (l) l.value = cfg.lang;
    if (p) p.value = cfg.provider;
    if (a) a.value = cfg.narrarAuto ? '1' : '0';
}

function salvarConfig() {
    cfg.voice = normalizarVoz(document.getElementById('cfgVoice')?.value || cfg.voice);
    cfg.lang = document.getElementById('cfgLang')?.value || cfg.lang;
    cfg.provider = document.getElementById('cfgProvider')?.value || cfg.provider;
    cfg.narrarAuto = document.getElementById('cfgAuto')?.value === '1';

    localStorage.setItem('aichat_cfg_local', JSON.stringify(cfg));
    if (cfg.voice !== 'off') {
        localStorage.setItem('user_elevenlabs_voice', cfg.voice);
        localStorage.setItem('user_voice_preference', cfg.voice);
    } else {
        localStorage.setItem('user_voice_preference', 'off');
    }
    localStorage.setItem('user_tts_provider', cfg.provider);
    localStorage.setItem('user_narrar_auto', cfg.narrarAuto ? '1' : '0');

    // O controller lê a preferência a cada resposta, então a mudança vale já
    // na próxima mensagem — sem recarregar a página.
    if (controladorAtivo) controladorAtivo.narrarAuto = cfg.narrarAuto && cfg.voice !== 'off';

    fecharConfig();

    // MongoDB é a fonte da verdade da preferência; o localStorage é só cache.
    const base = (window.API_BASE_URL || '/api').replace(/\/$/, '');
    const csrf = ('; ' + document.cookie).split('; csrf_token=')[1]?.split(';')[0] || '';

    fetch(base + '/auth/settings/tts', {
        method: 'POST',
        credentials: 'include',
        // Sem o token o validador de CSRF rejeita o POST com 403 e a preferência
        // nunca chega ao banco — as outras chamadas desta página já o enviavam.
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({
            ttsProvider: cfg.provider,
            voicePreference: cfg.voice,
            elevenlabsVoice: cfg.voice,
            narrarAuto: cfg.narrarAuto,
            speed: Number(localStorage.getItem('user_voice_speed') || 1.0),
            narrationMode: localStorage.getItem('user_narration_mode') || 'texto_audio',
        }),
    })
        // `fetch` só rejeita em falha de rede. Sem checar o `ok`, uma recusa do
        // servidor (o 500 da validação, por exemplo) passava como sucesso e a
        // preferência sumia ao trocar de aparelho, sem nenhum aviso.
        .then((r) => {
            if (!r.ok) throw new Error(String(r.status));
        })
        .catch(() => avisar('Preferência salva neste dispositivo, mas não no servidor.'));
}

function abrirConfig() {
    document.getElementById('configOverlay')?.classList.add('open');
}
function fecharConfig() {
    document.getElementById('configOverlay')?.classList.remove('open');
}

// ── Exportação da conversa ───────────────────────────────────────────────────

const FORMATOS = [
    { id: 'pdf', rotulo: 'PDF' },
    { id: 'docx', rotulo: 'Word (DOCX)' },
    { id: 'txt', rotulo: 'Texto (TXT)' },
];

/**
 * Baixa a conversa aberta.
 *
 * O download é feito por `fetch` + Blob (e não por um link direto) porque a
 * rota é POST e passa pelo validador CSRF — um `<a download>` não teria como
 * enviar o cabeçalho do token.
 */
async function baixarConversa(conversaId, formato) {
    const base = (window.API_BASE_URL || '/api').replace(/\/$/, '');
    const csrf = ('; ' + document.cookie).split('; csrf_token=')[1]?.split(';')[0] || '';

    const res = await fetch(`${base}/ia/exportar/${encodeURIComponent(conversaId)}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ formato }),
    });

    if (!res.ok) {
        const erro = await res.json().catch(() => ({}));
        throw new Error(erro.error || 'Não foi possível exportar a conversa.');
    }

    const blob = await res.blob();
    const nome =
        /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] ||
        `conversa.${formato}`;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nome;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Sem revoke o blob fica na memória da aba até o recarregamento.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function abrirExportacao(controlador) {
    if (!controlador.conversaId) {
        avisar('Envie ao menos uma mensagem antes de exportar.');
        return;
    }

    const overlay = document.getElementById('exportOverlay');
    const lista = document.getElementById('exportFormatos');
    if (!overlay || !lista) return;

    lista.innerHTML = '';
    for (const f of FORMATOS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ia-formato';
        b.textContent = f.rotulo;
        b.addEventListener('click', async () => {
            b.disabled = true;
            b.textContent = 'Gerando...';
            try {
                await baixarConversa(controlador.conversaId, f.id);
                overlay.classList.remove('open');
            } catch (e) {
                avisar(e.message);
            } finally {
                b.disabled = false;
                b.textContent = f.rotulo;
            }
        });
        lista.appendChild(b);
    }

    overlay.classList.add('open');
    lista.querySelector('button')?.focus();
}

/** Resposta local do /ajuda — não gasta chamada ao modelo para algo fixo. */
async function mostrarAjuda(controlador, paleta) {
    await paleta.carregar();
    const linhas = [
        '### O que eu posso fazer',
        '',
        'Converso sobre a rotina da escola, pedagogia e uso do sistema — e consulto os dados reais da sua escola quando a pergunta pede um número.',
        '',
        '**Comandos disponíveis para o seu perfil:**',
        '',
        ...paleta.comandos.map((c) => `- \`/${c.nome}\` — ${c.descricao}`),
        '',
        'Também dá para perguntar em português mesmo, sem comando: *"quantos alunos temos no 6ºB?"*',
    ];

    controlador.renderer.adicionarRespostaPronta(linhas.join('\n'), {
        aoCopiar: (t, b) => controlador._copiar(t, b),
    });
    controlador.renderer.rolarParaFim();
}

// ── Inicialização ────────────────────────────────────────────────────────────

async function iniciar() {
    // Guarda de autenticação — mesmo par usado pelas demais páginas do painel.
    try {
        if (typeof window.db !== 'undefined' && window.db.init) await window.db.init();
        if (typeof window.auth !== 'undefined' && window.auth.init) await window.auth.init();
        if (typeof window.auth !== 'undefined' && !window.auth.isAuthenticated()) {
            window.location.href = '../login.html';
            return;
        }
    } catch (e) {
        console.error('[IA] Falha ao inicializar a sessão:', e);
    }

    carregarConfig();
    definirVoltar(perfilProvavel());
    iniciarEsfera();

    const mensagens = document.getElementById('messages');
    mensagens.innerHTML = ESTADO_VAZIO_HTML;

    const controlador = new ChatController(
        {
            mensagens,
            entrada: document.getElementById('inputBox'),
            botaoEnviar: document.getElementById('sendBtn'),
            botaoParar: document.getElementById('stopBtn'),
            botaoNova: document.getElementById('newChatBtn'),
            contexto: document.getElementById('ctxBadge'),
            saudacao: document.getElementById('greeting'),
        },
        {
            aoMudarEstado: definirEstado,
            aoAvisar: avisar,
            // Corrige o "voltar" com o perfil que o SERVIDOR confirmou.
            aoReceberContexto: (ctx) => definirVoltar(ctx.perfil),
            // O título só existe depois que o servidor grava o turno.
            aoSalvarConversa: (c) => sidebar.registrar(c),
            narrarAuto: cfg.narrarAuto && cfg.voice !== 'off',
        }
    );

    controladorAtivo = controlador;

    // ── Conversas anteriores ────────────────────────────────────────────────
    const painelSidebar = document.getElementById('iaSidebar');
    const botaoHistorico = document.getElementById('historyBtn');

    const sidebar = new ConversationSidebar(document.getElementById('iaSidebarLista'), {
        aoAbrir: async (id) => {
            try {
                const conversa = await sidebar.obter(id);
                controlador.retomar(conversa);
                sidebar.marcarAtiva(id);
                fecharHistorico();
            } catch (e) {
                avisar(e.message || 'Não foi possível abrir a conversa.');
            }
        },
        // Apagar a conversa aberta esvazia a tela: continuar digitando nela
        // gravaria num registro que não existe mais.
        aoApagar: (id) => {
            if (controlador.conversaId === id) controlador.novaConversa();
        },
        aoAvisar: avisar,
    });

    function fecharHistorico() {
        painelSidebar.hidden = true;
        botaoHistorico.setAttribute('aria-expanded', 'false');
    }

    // ── Paleta de comandos (/) ──────────────────────────────────────────────
    const paleta = new CommandPalette(
        {
            painel: document.getElementById('iaPaleta'),
            entrada: controlador.el.entrada,
        },
        {
            aoEscolher: (comando) => {
                // O controller resolve prompt/navegação/nova; o resto é da página.
                if (controlador.executarComando(comando)) return;
                if (comando.nome === 'exportar') abrirExportacao(controlador);
                if (comando.nome === 'ajuda') mostrarAjuda(controlador, paleta);
            },
        }
    );
    controlador.conectarPaleta(paleta);

    document
        .getElementById('exportBtn')
        ?.addEventListener('click', () => abrirExportacao(controlador));

    botaoHistorico?.addEventListener('click', () => {
        const abrindo = painelSidebar.hidden;
        painelSidebar.hidden = !abrindo;
        botaoHistorico.setAttribute('aria-expanded', String(abrindo));
        if (abrindo) sidebar.carregar();
    });

    // Sugestões da tela vazia: preenchem a caixa e enviam.
    document.getElementById('messages').addEventListener('click', (e) => {
        const chip = e.target.closest('.ia-sugestao');
        if (!chip) return;
        controlador.el.entrada.value = chip.textContent.trim();
        controlador.enviar();
    });

    iniciarReconhecimentoVoz(controlador);

    document.getElementById('gearBtn')?.addEventListener('click', abrirConfig);
    document.getElementById('cfgCancel')?.addEventListener('click', fecharConfig);
    document.getElementById('cfgSave')?.addEventListener('click', salvarConfig);
    document.getElementById('configOverlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'configOverlay') fecharConfig();
    });

    const overlayExport = document.getElementById('exportOverlay');
    document
        .getElementById('expCancel')
        ?.addEventListener('click', () => overlayExport?.classList.remove('open'));
    overlayExport?.addEventListener('click', (e) => {
        if (e.target.id === 'exportOverlay') overlayExport.classList.remove('open');
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        fecharConfig();
        overlayExport?.classList.remove('open');
    });

    definirEstado('ocioso');
    if (typeof window.renderLucideIcons === 'function') window.renderLucideIcons();
    controlador.el.entrada.focus();
}

// ── Reconhecimento de Voz (STT) ──────────────────────────────────────────────
let recVoz = null;
let gravandoVoz = false;

/**
 * Liga a ação de voz ao gesto na esfera.
 *
 * O alvo é o `.orb-wrap`, e não o `#orb`: quando a esfera em canvas assume, o
 * orb sai da tela e um listener nele ficaria inalcançável. Como o wrap ganhou
 * `role="button"`, o teclado precisa funcionar junto com o ponteiro.
 *
 * @param {() => void} acao
 */
function ligarGestoDaEsfera(acao) {
    const alvo = document.getElementById('orbWrap');
    if (!alvo) return;
    alvo.addEventListener('click', acao);
    alvo.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault(); // Espaço rolaria o palco.
        acao();
    });
}

function iniciarReconhecimentoVoz(controlador) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btnMic = document.getElementById('micBtn');

    if (!SpeechRecognition) {
        if (btnMic) {
            btnMic.title = 'Reconhecimento de voz não suportado neste navegador';
            btnMic.addEventListener('click', () => {
                avisar(
                    'Seu navegador não suporta reconhecimento de voz. Use Chrome, Edge ou Safari.'
                );
            });
        }
        // Falta de microfone não tira a NARRAÇÃO: aqui a esfera continua
        // servindo para calar o assistente, o único gesto de voz que resta.
        document
            .getElementById('orbWrap')
            ?.setAttribute('aria-label', 'Parar a narração do assistente');
        ligarGestoDaEsfera(() => controlador.pararNarracao());
        return;
    }

    recVoz = new SpeechRecognition();
    recVoz.continuous = false;
    recVoz.interimResults = true;
    recVoz.lang = cfg.lang || 'pt-BR';

    // Só o resultado FINAL vira pergunta. Os parciais aparecem na caixa para a
    // pessoa acompanhar, mas enviar um parcial mandaria frase pela metade ao
    // assistente — e cada envio custa cota do modelo.
    let transcricaoFinal = '';
    let cancelandoVoz = false;

    recVoz.onstart = () => {
        gravandoVoz = true;
        transcricaoFinal = '';
        cancelandoVoz = false;
        btnMic?.classList.add('gravando');
        btnMic?.setAttribute('aria-pressed', 'true');
        definirEstado('ouvindo');
        avisar('Ouvindo... Fale agora. Clique de novo para enviar.');
    };

    recVoz.onresult = (event) => {
        let parcial = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const trecho = event.results[i][0].transcript;
            if (event.results[i].isFinal) transcricaoFinal += trecho;
            else parcial += trecho;
        }
        if (controlador.el.entrada) {
            controlador.el.entrada.value = (transcricaoFinal + parcial).trim();
            controlador._ajustarAltura();
        }
    };

    recVoz.onerror = (event) => {
        console.warn('[Voz] Erro no reconhecimento de voz:', event.error);
        cancelandoVoz = true;
        gravandoVoz = false;
        btnMic?.classList.remove('gravando');
        btnMic?.setAttribute('aria-pressed', 'false');
        definirEstado('ocioso');

        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            avisar('Permissão de microfone negada. Libere o microfone nas configurações do site.');
        } else if (event.error === 'no-speech') {
            avisar('Não ouvi nada. Toque no microfone e fale mais perto.');
        } else if (event.error !== 'aborted') {
            avisar('Não foi possível ouvir. Verifique o microfone e a conexão.');
        }
    };

    recVoz.onend = () => {
        gravandoVoz = false;
        btnMic?.classList.remove('gravando');
        btnMic?.setAttribute('aria-pressed', 'false');
        definirEstado('ocioso');

        // Ditar e ainda ter que apertar "enviar" quebra o uso sem as mãos, que
        // é justamente o motivo de existir o microfone.
        const pergunta = transcricaoFinal.trim();
        if (!cancelandoVoz && pergunta && controlador.el.entrada) {
            controlador.el.entrada.value = pergunta;
            controlador.enviar();
        }
        transcricaoFinal = '';
    };

    function alternarGravacao() {
        if (!recVoz) return;
        if (gravandoVoz) {
            recVoz.stop();
        } else {
            try {
                recVoz.lang = cfg.lang || 'pt-BR';
                recVoz.start();
            } catch (e) {
                console.error('[Voz] Falha ao iniciar gravação:', e);
            }
        }
    }

    // Falar por cima da narração é o gesto natural para interromper o
    // assistente, então o microfone sempre cala o áudio antes de abrir.
    function calarENovamenteOuvir() {
        controlador.pararNarracao();
        alternarGravacao();
    }

    btnMic?.addEventListener('click', calarENovamenteOuvir);
    ligarGestoDaEsfera(calarENovamenteOuvir);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
} else {
    iniciar();
}
