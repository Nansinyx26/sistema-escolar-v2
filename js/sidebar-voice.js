/**
 * Sidebar and Voice Command Logic 3.0
 */

/**
 * ─── Catálogo de vozes (window.Vozes) ───────────────────────────────────────
 *
 * Fica aqui, e não num arquivo novo, porque este é o módulo que já define
 * `window.speak()` — sem ele não há narração nenhuma, então uma tela que tem
 * voz tem necessariamente este arquivo, e ele carrega antes de
 * `js/chatbot-ia.js` em todas as páginas que têm o chatbot.
 *
 * A lista existia copiada em cinco lugares, com rótulos diferentes em cada um:
 * a mesma voz era "Brian — Profundo e Tranquilo" aqui, "Brian — Tranquilo" na
 * gaveta e "Brian — grave e tranquila" na página do assistente. Acrescentar
 * uma quinta voz significava lembrar de cinco arquivos, e esquecer um deixava
 * a voz existindo em metade do sistema.
 *
 * Este objeto passa a ser a fonte para este arquivo e para o chatbot.
 * `js/settings-drawer.js` e `html/direcao/ia-assistant.html` seguem com as
 * opções escritas à mão de propósito: a gaveta é carregada em ~44 páginas,
 * várias sem `sidebar-voice.js`, e ali um seletor vazio seria pior que um
 * rótulo desalinhado. (Além disso `vozBrianPadrao.test.js` fixa a ordem no
 * texto daqueles dois arquivos.)
 *
 * Os IDs do provedor NÃO moram aqui — eles vivem em
 * `backend/src/services/TTSService.js`, que é quem fala com a ElevenLabs. O
 * front manda só o nome ('brian'), e o backend resolve.
 */
window.Vozes = (function () {
    'use strict';

    /** Ordem importa: é a ordem em que aparecem, e a primeira é a padrão. */
    var LISTA = [
        { nome: 'brian', rotulo: 'Brian', descricao: 'Grave e tranquila' },
        { nome: 'adam', rotulo: 'Adam', descricao: 'Firme e direta' },
        { nome: 'eric', rotulo: 'Eric', descricao: 'Suave e natural' },
        { nome: 'george', rotulo: 'George', descricao: 'Calorosa e pausada' },
    ];

    var PADRAO = 'brian';
    var CHAVE = 'user_elevenlabs_voice';

    function ler(chave, alternativa) {
        try {
            var v = localStorage.getItem(chave);
            return v === null ? alternativa : v;
        } catch (e) {
            return alternativa;
        }
    }

    function gravar(chave, valor) {
        try {
            localStorage.setItem(chave, String(valor));
        } catch (e) {
            /* armazenamento cheio ou bloqueado — a escolha vale só nesta aba */
        }
    }

    /**
     * Normaliza a voz salva.
     *
     * Instalações antigas gravaram 'male' e 'female' nesta chave, quando ela
     * ainda guardava GÊNERO em vez de nome de voz. Mandar 'male' ao backend
     * não estoura nada — ele cai no fallback — mas o seletor ficava sem
     * nenhuma opção marcada, e a pessoa via um campo em branco descrevendo uma
     * escolha que ela tinha feito.
     */
    function normalizar(valor) {
        var v = String(valor || '').toLowerCase();
        for (var i = 0; i < LISTA.length; i++) {
            if (LISTA[i].nome === v) return v;
        }
        return PADRAO;
    }

    /** A voz em uso agora, sempre um nome válido. */
    function atual() {
        return normalizar(ler(CHAVE, PADRAO));
    }

    function porNome(nome) {
        var alvo = normalizar(nome);
        for (var i = 0; i < LISTA.length; i++) {
            if (LISTA[i].nome === alvo) return LISTA[i];
        }
        return LISTA[0];
    }

    /**
     * Registra a escolha e avisa o resto da página.
     *
     * Grava no navegador PRIMEIRO e no servidor depois, sem esperar: a próxima
     * narração lê o localStorage, e fazer a troca de voz depender de uma
     * ida à rede daria a impressão de que o clique não pegou.
     *
     * @param {string} nome
     * @param {{ previa?: boolean }} [opcoes] `previa` narra uma frase curta na
     *   voz nova — a única forma de escolher uma voz é ouvindo-a.
     * @returns {string} o nome efetivamente aplicado (já normalizado)
     */
    function definir(nome, opcoes) {
        var escolhida = normalizar(nome);
        gravar(CHAVE, escolhida);
        // O backend só tem vozes masculinas; esta chave legada é lida por telas
        // antigas e continuaria em 'female' num usuário migrado.
        gravar('user_voice_preference', 'male');

        window.dispatchEvent(new CustomEvent('voiceChanged', { detail: { voice: escolhida } }));

        if (typeof window.saveAccessibilityPreference === 'function') {
            window.saveAccessibilityPreference({ elevenlabsVoice: escolhida });
        }

        if (opcoes && opcoes.previa && typeof window.speak === 'function') {
            window.speak('Voz alterada com sucesso!');
        }
        return escolhida;
    }

    /** Preenche um `<select>` com as vozes e marca a que está em uso. */
    function preencherSelect(select) {
        if (!select) return;
        select.innerHTML = LISTA.map(function (v) {
            return (
                '<option value="' +
                v.nome +
                '" data-elevenlabs-voice="1">' +
                v.rotulo +
                ' — ' +
                v.descricao +
                '</option>'
            );
        }).join('');
        select.value = atual();
    }

    return {
        LISTA: LISTA,
        PADRAO: PADRAO,
        CHAVE: CHAVE,
        normalizar: normalizar,
        atual: atual,
        porNome: porNome,
        definir: definir,
        preencherSelect: preencherSelect,
    };
})();

document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.remove('high-contrast');
    initSidebar();
    initSidebarProfile();
    initVoiceCommand();
    initVoiceToggles();
});

/**
 * Sidebar Toggle and Persistence
 */
function initSidebar() {
    const sidebar = document.getElementById('mainSidebar');
    const toggle = document.getElementById('sidebarToggle');
    const wrapper = document.getElementById('pageWrapper');

    if (!sidebar || !toggle) return;

    // Troca o chevron do botão de recolher.
    //
    // O js/libs/lucide-init.js SUBSTITUI a tag `<i class="bi bi-chevron-left">`
    // por um `<svg>` (replaceChild). Depois disso `toggle.querySelector('i')`
    // volta null e o `.classList.replace(...)` antigo estourava um TypeError
    // não tratado a cada clique — o erro que o `window.onerror` do
    // js/dashboard.js transformava no toast "Erro interno no Dashboard".
    // Além disso, trocar a classe no `<svg>` não redesenharia o traço: o
    // caminho já foi renderizado. Recriamos o `<i>` e mandamos o Lucide
    // desenhar de novo.
    const setToggleIcon = (collapsed) => {
        const icon = toggle.querySelector('i, svg');
        if (!icon) return;
        const novo = document.createElement('i');
        novo.className = collapsed ? 'bi bi-chevron-right' : 'bi bi-chevron-left';
        icon.replaceWith(novo);
        if (typeof window.renderLucideIcons === 'function') window.renderLucideIcons();
    };

    // Load state
    const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
    if (isCollapsed) {
        sidebar.classList.add('collapsed');
        wrapper?.classList.add('collapsed');
        setToggleIcon(true);
    }

    toggle.addEventListener('click', () => {
        const collapsed = sidebar.classList.toggle('collapsed');
        wrapper?.classList.toggle('collapsed');
        localStorage.setItem('sidebar_collapsed', collapsed);

        setToggleIcon(collapsed);
    });

    // Mobile logic
    const createOverlay = () => {
        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        document.body.appendChild(overlay);
        return overlay;
    };

    const overlay = document.querySelector('.sidebar-overlay') || createOverlay();

    const isMobileSidebar = () => window.matchMedia('(max-width: 768px)').matches;

    const openMobileSidebar = () => {
        sidebar.classList.add('mobile-open');
        overlay.classList.add('visible');
        document.body.classList.add('sidebar-open');
        // Trava compartilhada: não conflita com modais abertos por cima.
        window.ScrollLock?.lock('sidebar');
        overlay.setAttribute('aria-hidden', 'false');
        const burger = document.getElementById('mobileHamburger');
        if (burger) {
            burger.setAttribute('aria-expanded', 'true');
            burger.setAttribute('aria-label', 'Fechar menu lateral');
            burger.classList.add('is-active');
        }
    };

    const closeMobileSidebar = () => {
        sidebar.classList.remove('mobile-open');
        overlay.classList.remove('visible');
        document.body.classList.remove('sidebar-open');
        window.ScrollLock?.unlock('sidebar');
        overlay.setAttribute('aria-hidden', 'true');
        const burger = document.getElementById('mobileHamburger');
        if (burger) {
            burger.setAttribute('aria-expanded', 'false');
            burger.setAttribute('aria-label', 'Abrir menu lateral');
            burger.classList.remove('is-active');
        }
    };

    const toggleMobileSidebar = () => {
        if (sidebar.classList.contains('mobile-open')) closeMobileSidebar();
        else openMobileSidebar();
    };

    overlay.addEventListener('click', closeMobileSidebar);

    window.DashboardSidebar = {
        open: openMobileSidebar,
        close: closeMobileSidebar,
        toggle: toggleMobileSidebar,
        isOpen: () => sidebar.classList.contains('mobile-open'),
    };

    // Add mobile burger só se a página não já tiver um hambúrguer no header.
    // (o dashboard já traz #headerHamburger no HTML — injetar outro criava DOIS
    // menus hambúrguer idênticos no mobile.)
    const menuBtnContainer =
        document.querySelector('.header-left') ||
        document.querySelector('.navbar-content') ||
        document.querySelector('.dashboard-header');
    if (
        sidebar &&
        menuBtnContainer &&
        !document.getElementById('mobileHamburger') &&
        !document.getElementById('headerHamburger')
    ) {
        const burger = document.createElement('button');
        burger.id = 'mobileHamburger';
        burger.type = 'button';
        burger.className = 'btn-hamburger';
        burger.innerHTML = '<i class="bi bi-list"></i>';
        burger.setAttribute('aria-label', 'Abrir menu lateral');
        burger.setAttribute('aria-expanded', 'false');
        burger.setAttribute('aria-controls', 'mainSidebar');
        burger.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMobileSidebar();
        });
        menuBtnContainer.prepend(burger);
    }

    const headerHamburger = document.getElementById('headerHamburger');
    if (headerHamburger) {
        headerHamburger.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMobileSidebar();
        });
    }

    sidebar.querySelectorAll('.sidebar-item').forEach((item) => {
        item.addEventListener('click', () => {
            if (isMobileSidebar()) closeMobileSidebar();
        });
    });

    window.addEventListener('resize', () => {
        if (!isMobileSidebar() && sidebar.classList.contains('mobile-open')) {
            closeMobileSidebar();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('mobile-open')) {
            closeMobileSidebar();
        }
    });

    setActiveSidebarItem();
}

/**
 * Automagically sets .active class based on current URL
 *
 * A versão antiga comparava com `currentPath.includes(href)`. Quando o href é
 * um caminho absoluto completo (`/html/direcao/bi-pedagogico.html`) isso nunca
 * casa, e como o `.active` de TODOS os itens era removido antes do teste, a
 * sidebar acabava sem nenhum item destacado — inclusive o que já vinha marcado
 * como `active` no HTML. Agora resolvemos cada href contra a URL atual e
 * comparamos caminhos normalizados; sem correspondência, preservamos o que o
 * HTML declarou.
 */
function setActiveSidebarItem() {
    const normalize = (path) => {
        const p = path.toLowerCase();
        return p.endsWith('/') ? p + 'index.html' : p;
    };

    const currentPath = normalize(window.location.pathname);
    const sidebarItems = Array.from(document.querySelectorAll('.sidebar-item'));

    const match = sidebarItems.find((item) => {
        const href = item.getAttribute('href');
        if (!href || href === '#' || href.toLowerCase().startsWith('javascript:')) return false;
        try {
            return normalize(new URL(href, window.location.href).pathname) === currentPath;
        } catch (e) {
            return false;
        }
    });

    if (!match) return;

    sidebarItems.forEach((item) => {
        item.classList.remove('active');
    });
    match.classList.add('active');
}

/**
 * Sidebar User Profile Population and Accessibility Loading
 */
function initSidebarProfile() {
    let reconciled = false;
    const updateProfile = () => {
        const user = window.auth ? window.auth.getCurrentUser() : null;
        if (!user) return;

        // Reconcilia com o servidor (fonte de verdade): se o sessionStorage
        // tinha um usuário antigo/de outra conta em cache, corrige tudo.
        if (!reconciled && window.auth && window.auth.refreshCurrentUser) {
            reconciled = true;
            window.auth.refreshCurrentUser().then((fresh) => {
                if (!fresh) return;
                const idAntigo = String(user._id || user.id || '');
                const idNovo = String(fresh._id || fresh.id || '');
                // Conta diferente em cache (ex.: login anterior preso): o cache já
                // foi reescrito por refreshCurrentUser; recarrega UMA vez para que
                // TODAS as telas (dashboard, detalhes, filtros) usem a conta certa.
                if (idNovo && idAntigo && idNovo !== idAntigo) {
                    try {
                        if (!sessionStorage.getItem('auth_reconciled_reload')) {
                            sessionStorage.setItem('auth_reconciled_reload', '1');
                            location.reload();
                            return;
                        }
                    } catch (e) {
                        /* noop */
                    }
                }
                // Mesmo id, só nome/foto desatualizados: re-render simples.
                if (fresh.nome !== user.nome) updateProfile();
            });
        }

        const avatar = document.getElementById('sidebarAvatar');
        const name = document.getElementById('sidebarUserName');
        const role = document.getElementById('sidebarUserRole');
        const escola = document.getElementById('sidebarUserEscola');

        if (avatar) {
            avatar.src = window.getPhotoUrl
                ? window.getPhotoUrl(user.foto, user.fotoGoogle)
                : user.foto || user.fotoGoogle || '/img/default-avatar.png';
        }
        if (name) name.textContent = user.nome || 'Usuário';
        if (role) {
            // Fonte única: js/auth.js → resolverPerfilAtivo. O ternário que
            // vivia aqui transformava admin, secretaria e responsável em
            // "Professor(a)", porque só distinguia 'diretor' de todo o resto.
            role.textContent = window.rotuloPerfilAtivo
                ? window.rotuloPerfilAtivo(user, window.escolaAtivaId && window.escolaAtivaId())
                : '—';
        }
        if (escola) {
            escola.textContent = user.escola || 'Escola Padrão';
        }

        // --- CARREGAMENTO DE PREFERÊNCIAS (MONGODB - SOURCE OF TRUTH) ---

        // 1. Narração/Display Mode
        const mode = user.settings?.narrationMode || user.preferenciaNarracao || 'texto_audio';
        localStorage.setItem('user_narration_mode', mode);
        applyDisplayModeClass(mode);
        const modeSelect = document.getElementById('voice-mode-select');
        if (modeSelect) modeSelect.value = mode;

        // 2. Velocidade da Voz (FIXADA em 1.0x conforme solicitado)
        localStorage.setItem('user_voice_speed', 1.0);

        // 3. Provedor TTS preferido (Fixo em ElevenLabs)
        localStorage.setItem('user_tts_provider', 'elevenlabs');

        // 4. Voz ElevenLabs (persiste preferência do usuário)
        if (!localStorage.getItem('user_elevenlabs_voice')) {
            localStorage.setItem('user_elevenlabs_voice', 'brian');
        }
        // Gênero fixo Masculino
        localStorage.setItem('user_voice_preference', 'male');

        // --- ENSURE VISIBILITY ---
        // Ensure voice selector is never hidden by "Apenas Texto" mode initialization
        const wrapper = document.querySelector('.voice-selector-wrapper');
        if (wrapper) wrapper.style.display = 'block';

        // 5. Tamanho da Fonte
        const fontSize = user.accessibilityFontSize || '100%';
        document.documentElement.style.fontSize = fontSize;

        // 6. Modo Leitura
        const reading = !!user.accessibilityReadingMode;
        document.body.classList.toggle('reading-mode', reading);
        const readingBtn = document.getElementById('btn-toggle-reading');
        if (readingBtn) readingBtn.classList.toggle('active', reading);
    };

    updateProfile();

    // Novo: escuta atualizações de perfil (ex: vindo do auth.refreshUser)
    window.addEventListener('auth:updated', updateProfile);
}

/**
 * Global Voice Synthesis (TTS) Helper
 *
 * Preferências salvas no localStorage:
 *   user_voice_preference  → 'female' | 'male' | 'off'
 *   user_tts_provider      → 'auto' | 'gemini' | 'elevenlabs'
 *
 * O campo `provider` é enviado ao backend que tenta o provedor escolhido
 * e faz fallback automático para o outro caso falhe.
 * Se o backend falhar por completo, exibe um alerta de erro.
 */
let currentAudio = null;

window.speak = async (text, forceSpeak = false) => {
    if (!text) return null;

    // Cancela áudio anterior
    if (window.stopTtsAudio) window.stopTtsAudio();

    try {
        console.log('[Voice] Enviando texto para TTS backend:', text.substring(0, 60) + '...');

        const response = await fetch(`${window.API_BASE_URL || '/api'}/tts/speak`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': document.cookie.match(/csrf_token=([^;]+)/)?.[1] || '',
            },
            body: JSON.stringify({
                text: text,
                voice: 'male',
                provider: 'elevenlabs',
                voiceId: localStorage.getItem('user_elevenlabs_voice') || 'brian',
            }),
            credentials: 'include',
        });

        if (!response.ok) {
            const errBody = await response.text().catch(() => '');
            console.error(`[Voice] TTS falhou: HTTP ${response.status}`, errBody);
            // Mostrar erro visível ao usuário
            if (window.showToast) {
                window.showToast(
                    `Erro na voz: ${response.status === 401 ? 'Sessão expirada' : 'Servidor indisponível'}`,
                    'error'
                );
            }
            return null;
        }

        const blob = await response.blob();
        if (blob.size < 100) {
            console.warn('[Voice] Áudio retornado muito pequeno:', blob.size, 'bytes');
            return null;
        }

        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);

        window.currentTtsAudio = audio;
        currentAudio = audio;

        // `addEventListener` e NÃO `audio.onended = ...`: a propriedade guarda
        // um handler só, e quem recebe este elemento de volta (o
        // ChatController do copiloto) atribuía o dele por cima. A limpeza
        // abaixo deixava de rodar e cada resposta narrada vazava um Blob na
        // memória da aba, além de nunca disparar `tts:ended`. Ver Issue #175.
        audio.addEventListener(
            'ended',
            () => {
                window.dispatchEvent(new CustomEvent('tts:ended'));
                URL.revokeObjectURL(url);
                currentAudio = null;
            },
            { once: true }
        );

        // O áudio também pode morrer sem chegar ao fim (rede caiu no meio,
        // codec recusado). Sem isto o Blob desse caminho ficava retido.
        audio.addEventListener(
            'error',
            () => {
                URL.revokeObjectURL(url);
                currentAudio = null;
            },
            { once: true }
        );

        await audio.play();
        console.log('[Voice] ✅ Áudio reproduzindo com sucesso');
        window.dispatchEvent(new CustomEvent('tts:started'));
        return audio;
    } catch (error) {
        console.error('[Voice] Erro no pipeline TTS:', error.message);
        if (window.showToast) {
            window.showToast('Erro ao reproduzir áudio. Verifique a conexão.', 'error');
        }
        return null;
    }
};

window.stopTtsAudio = () => {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    document.querySelectorAll('.voice-wave-container, .voice-animation-container').forEach((el) => {
        el.style.display = 'none';
    });
    if (window.VoiceOrbManager) window.VoiceOrbManager.destroy();
};

function initVoiceCommand() {
    // REMOVIDO: Proibição de uso da Web Speech API nativa
    console.log('[Voice] Comandos de voz via navegador desativados por política de segurança.');
}

document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action], [data-href]');
    if (!target) return;
    const action = target.getAttribute('data-action');
    const href = target.getAttribute('data-href');
    if (action === 'sair') {
        if (typeof window.sair === 'function') window.sair();
        else if (window.auth) window.auth.logout();
    } else if (href) {
        window.location.href = href;
    }
});

function initVoiceToggles() {
    const btnSettings = document.getElementById('btn-voice-settings');
    const panel = document.getElementById('voice-settings-panel');
    const btnActivate = document.getElementById('btn-activate-voice');
    const optBtns = document.querySelectorAll('.voice-opt-btn');
    const modeSelect = document.getElementById('voice-mode-select');

    if (btnSettings && panel) {
        btnSettings.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
        });
        document.addEventListener('click', () => {
            if (panel) panel.style.display = 'none';
        });
        panel.addEventListener('click', (e) => e.stopPropagation());
    }

    // Botão "Configurações Voz" da sidebar → abre a gaveta de Configurações,
    // que tem os controles completos (provedor, voz, velocidade, volume).
    //
    // Antes ele apenas alternava o painelzinho do header — um popover de 240px
    // ancorado no canto superior direito, longe do clique e fora da tela se a
    // página estivesse rolada. Pior: no dashboard o `onclick` inline do HTML já
    // clicava em #btn-voice-settings, então este listener alternava de volta no
    // mesmo clique e o botão parecia completamente morto.
    //
    // O bind fica FORA do `if (btnSettings && panel)` porque a gaveta não
    // depende do painel legado existir na página.
    const sidebarVoiceBtn = document.getElementById('sidebar-voice-btn');
    if (sidebarVoiceBtn) {
        sidebarVoiceBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // stopPropagation próprio: sem isso o clique sobe até o document e
            // o listener global acima fecha o painel no mesmo clique.
            e.stopPropagation();
            if (typeof window.openSettingsDrawer === 'function') {
                if (panel) panel.style.display = 'none';
                window.openSettingsDrawer();
            } else if (panel) {
                panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
            }
        });
    }

    // --- Seletor de voz ElevenLabs ---
    const voiceSelect = document.getElementById('voice-provider-select');
    if (voiceSelect) {
        // A lista vem do catálogo, não de um array local: era a quinta cópia
        // das mesmas quatro vozes, e a única com o rótulo "Firme e Dominante"
        // enquanto as outras telas diziam "Firme".
        window.Vozes.preencherSelect(voiceSelect);

        voiceSelect.addEventListener('change', () => {
            // A gaveta de configurações (js/settings-drawer.js) grava a voz e
            // DEPOIS dispara um `change` sintético neste select para mantê-lo
            // em sincronia. Sem esta guarda, aquele eco reexecutava tudo: dois
            // POST para o servidor e duas prévias, a segunda cortando a
            // primeira no meio da frase. Se o valor já é o que está gravado,
            // não houve escolha nova — só o eco.
            if (voiceSelect.value === window.Vozes.atual()) return;

            // `definir` grava, avisa a página, persiste no servidor e toca a
            // prévia — os quatro passos que antes estavam soltos aqui, e dos
            // quais a persistência simplesmente não existia.
            window.Vozes.definir(voiceSelect.value, { previa: true });
        });

        // Trocar a voz na gaveta de configurações tem de refletir aqui.
        window.addEventListener('voiceChanged', (e) => {
            const voz = e.detail && e.detail.voice;
            if (voz && voiceSelect.value !== voz) voiceSelect.value = voz;
        });
    }

    const updateVoiceUI = () => {
        optBtns.forEach((btn) => {
            const v = btn.getAttribute('data-voice');
            if (v === 'female') {
                btn.style.display = 'none';
                return;
            }
            if (v === 'male') {
                btn.style.borderColor = '#10b981';
                btn.style.background = 'rgba(16, 185, 129, 0.1)';
            }
        });
    };

    if (modeSelect) {
        modeSelect.addEventListener('change', () => {
            const mode = modeSelect.value;
            localStorage.setItem('user_narration_mode', mode);
            applyDisplayModeClass(mode);
        });
    }

    if (btnActivate) {
        btnActivate.addEventListener('click', () => {
            window.speak('Voz masculina ativada. Posso te ajudar?');
        });
    }

    updateVoiceUI();
}

/**
 * Grava as preferências de narração no servidor.
 *
 * Estava vazia — "mantido para compatibilidade" — com o comentário de que o
 * sistema tinha sido travado numa voz só. Só que a escolha de voz voltou a
 * existir, o campo `settings.elevenlabsVoice` está no modelo e a rota
 * `POST /api/auth/settings/tts` continua de pé e coberta por teste. Com a
 * função vazia, a voz escolhida vivia apenas no localStorage: quem escolhia
 * Eric no computador da escola ouvia Brian no próprio celular, sem nenhuma
 * pista do motivo.
 *
 * Falha em silêncio de propósito. A voz JÁ está gravada no navegador quando
 * esta função roda, então a escolha vale nesta sessão de qualquer jeito — um
 * alerta aqui interromperia quem só queria trocar de voz para relatar uma
 * falha de sincronização que não o afeta agora.
 *
 * @param {{ elevenlabsVoice?: string, voicePreference?: string,
 *           ttsProvider?: string, narrarAuto?: boolean, speed?: number,
 *           narrationMode?: string }} prefs
 */
async function saveAccessibilityPreference(prefs = {}) {
    const corpo = {};
    if (prefs.elevenlabsVoice) {
        corpo.elevenlabsVoice = prefs.elevenlabsVoice;
        // O controller copia `voicePreference` para o campo legado `voiceGender`
        // apenas quando ele é 'male'/'female'; mandar o NOME da voz aqui fazia
        // o update inteiro voltar 500 e nenhuma preferência era gravada.
        corpo.voicePreference = 'male';
        corpo.ttsProvider = 'elevenlabs';
    }
    if (prefs.voicePreference) corpo.voicePreference = prefs.voicePreference;
    if (prefs.ttsProvider) corpo.ttsProvider = prefs.ttsProvider;
    if (prefs.narrarAuto !== undefined) corpo.narrarAuto = prefs.narrarAuto;
    if (prefs.speed !== undefined) corpo.speed = prefs.speed;
    if (prefs.narrationMode) corpo.narrationMode = prefs.narrationMode;
    if (Object.keys(corpo).length === 0) return;

    try {
        const csrf = getCsrfToken();
        const resposta = await fetch(`${window.API_BASE_URL || '/api'}/auth/settings/tts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
            },
            credentials: 'include',
            body: JSON.stringify(corpo),
        });
        if (!resposta.ok) {
            console.warn(`[Voz] Preferência não gravada no servidor: HTTP ${resposta.status}`);
        }
    } catch (erro) {
        console.warn('[Voz] Preferência não gravada no servidor:', erro.message);
    }
}

window.saveAccessibilityPreference = saveAccessibilityPreference;

function applyDisplayModeClass(mode) {
    document.body.classList.remove(
        'preference-texto',
        'preference-texto-audio',
        'preference-audio'
    );
    if (mode === 'texto') document.body.classList.add('preference-texto');
    else if (mode === 'audio') document.body.classList.add('preference-audio');
    else document.body.classList.add('preference-texto-audio');
}

function getCsrfToken() {
    const match = document.cookie.match(/csrf_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}
