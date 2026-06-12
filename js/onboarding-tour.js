/**
 * onboarding-tour.js — Tour guiado (Professor / Diretor)
 * Layout sidebar + header — spotlight responsivo com scroll automático
 */
(function () {
    'use strict';

    const PROFESSOR_STEPS = [
        { title: 'Boas-vindas', content: 'Bem-vindo ao Sistema Escolar! Este tour mostra os principais recursos da sua dashboard com o novo layout.', target: null },
        { title: 'Área Principal', content: 'Aqui você vê a mensagem de boas-vindas e um resumo rápido da sua rotina docente.', target: '.welcome-section' },
        { title: 'Menu Lateral', content: 'O menu lateral concentra todas as áreas do sistema. No celular, use o botão ☰ no topo para abrir e fechar.', target: '#mainSidebar' },
        { title: 'Seu Perfil', content: 'Veja sua foto, nome e função. Clique em "Meu Perfil" no menu para editar seus dados.', target: '.sidebar-profile' },
        { title: 'Área do Professor', content: 'Acesse Minhas Turmas, Frequência e Meu Horário diretamente por aqui.', target: '#sidebar-horario, a[href="selecionar.html"].sidebar-item' },
        { title: 'Central de Notificações', content: 'Fique por dentro de avisos importantes. O badge vermelho indica mensagens não lidas.', target: '#notif-btn, .notif-wrapper' },
        { title: 'Voz & Acessibilidade', content: 'Configure narração, velocidade da voz, tamanho da fonte e modo leitura.', target: '#btn-voice-settings' },
        { title: 'Mural da Comunidade', content: 'Canal oficial de comunicados da escola com interações em tempo real.', target: '#muralSection, #announcement-feed-container' },
        { title: 'Avaliar Sistema', content: 'Sua opinião é fundamental! Avalie a plataforma e ajude-nos a evoluir.', target: '#reviewSection, .review-section' },
        { title: 'Privacidade LGPD', content: 'Gerencie seus dados pessoais e entenda seus direitos de privacidade.', target: 'a[href="meus-dados.html"].sidebar-item, a[href="meus-dados.html"]' },
        { title: 'Tour Guiado', content: 'A qualquer momento, clique neste botão para rever este tour.', target: '#btn-restart-tour' },
        { title: 'Pronto!', content: 'Tour concluído! Explore o sistema com confiança. Bom trabalho!', target: null }
    ];

    const DIRECTOR_STEPS = [
        { title: 'Painel da Direção', content: 'Boas-vindas ao seu painel administrativo. Visão global da escola em um só lugar.', target: null },
        { title: 'Resumo da Escola', content: 'Indicadores em tempo real: total de alunos, professores e turmas ativas.', target: '#directorDashboardSummary' },
        { title: 'Código Secreto', content: 'Código diário para novos professores se cadastrarem. Renova automaticamente para maior segurança.', target: '#securityPanel, #dashboardDailyCode' },
        { title: 'Atividade e Avisos', content: 'Acompanhe a atividade recente e os últimos comunicados enviados pela escola.', target: '#directorActivityGrid' },
        { title: 'Menu Administrativo', content: 'Gerencie alunos, professores, salas, horários e códigos secretos pelo menu lateral.', target: '#mainSidebar .director-only, #mainSidebar' },
        { title: 'Central de Notificações', content: 'Receba alertas internos e avisos do sistema. Clique no sino para abrir o painel.', target: '#notif-btn, .notif-wrapper' },
        { title: 'Voz & Acessibilidade', content: 'Personalize narração, velocidade e preferências visuais do sistema.', target: '#btn-voice-settings' },
        { title: 'Mural da Comunidade', content: 'Visualize e gerencie comunicados publicados para toda a comunidade escolar.', target: '#muralSection' },
        { title: 'Privacidade LGPD', content: 'Portal de privacidade conforme a legislação vigente.', target: 'a[href="meus-dados.html"]' },
        { title: 'Tour Guiado', content: 'Clique aqui sempre que quiser rever este tour.', target: '#btn-restart-tour' },
        { title: 'Pronto!', content: 'Você está pronto para administrar a escola com eficiência!', target: null }
    ];

    let currentStep = 0;
    let overlay, popup, spotlight, indicator, arrow;
    let tourActive = false;
    let saving = false;
    let tourSteps = PROFESSOR_STEPS;
    let scrollRaf = null;
    let sidebarWasOpenedByTour = false;

    const MOBILE_BP = 768;
    const isMobile = () => window.innerWidth <= MOBILE_BP;

    const addTourStyles = () => {
        if (document.getElementById('tour-styles')) return;
        const style = document.createElement('style');
        style.id = 'tour-styles';
        style.textContent = `
            #onboarding-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 100000; opacity: 0; transition: opacity .4s ease; pointer-events: none; }
            #onboarding-spotlight {
                position: fixed; z-index: 100001; pointer-events: none;
                border-radius: 14px;
                box-shadow: 0 0 0 9999px rgba(0,0,0,0.72), 0 0 30px rgba(16,185,129,0.4);
                border: 2px solid #10b981;
                transition: top .45s cubic-bezier(0.19, 1, 0.22, 1), left .45s cubic-bezier(0.19, 1, 0.22, 1), width .45s cubic-bezier(0.19, 1, 0.22, 1), height .45s cubic-bezier(0.19, 1, 0.22, 1);
                display: none;
            }
            #onboarding-spotlight::before {
                content: ''; position: absolute; inset: -4px;
                border: 2px solid #10b981; border-radius: 18px;
                opacity: 0.6; animation: spotlight-pulse 2s infinite;
            }
            @keyframes spotlight-pulse { 0% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(1.08); opacity: 0; } }
            #onboarding-indicator {
                position: fixed; width: 24px; height: 24px; background: #10b981;
                border-radius: 50%; z-index: 100002; pointer-events: none;
                display: none; animation: indicator-bounce 1s infinite alternate;
                box-shadow: 0 0 20px #10b981;
            }
            @keyframes indicator-bounce { from { transform: translateY(0); } to { transform: translateY(-10px); } }
            #onboarding-popup {
                position: fixed; z-index: 100005;
                background: rgba(24, 24, 27, 0.92);
                backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 24px; padding: 1.5rem; max-width: 400px; width: calc(100vw - 2rem);
                box-shadow: 0 30px 60px rgba(0,0,0,0.6);
                opacity: 0; transform: translateY(20px); transition: opacity .4s ease, transform .4s ease;
                box-sizing: border-box;
            }
            #onboarding-arrow {
                position: fixed; width: 0; height: 0;
                border-left: 10px solid transparent; border-right: 10px solid transparent;
                border-bottom: 10px solid rgba(24, 24, 27, 0.92);
                z-index: 100006; display: none; transition: all .4s ease;
            }
            .tour-glass-btn {
                padding: 10px 20px; border-radius: 12px; font-weight: 700; font-size: 0.85rem;
                cursor: pointer; transition: all 0.2s; border: 1px solid rgba(255,255,255,0.1);
            }
            .btn-next-tour { background: #10b981; color: #fff; border: none; box-shadow: 0 8px 20px rgba(16,185,129,0.3); }
            .btn-next-tour:hover { transform: translateY(-2px); box-shadow: 0 12px 25px rgba(16,185,129,0.5); }
            .btn-back-tour { background: rgba(255,255,255,0.05); color: #fff; }
            .btn-skip-tour { background: transparent; color: rgba(255,255,255,0.4); border: none; }
            .btn-skip-tour:hover { color: #fff; }
            @media (max-width: 768px) {
                #onboarding-popup { padding: 1.25rem; max-width: calc(100vw - 1.5rem); }
            }
        `;
        document.head.appendChild(style);
    };

    function createUI() {
        if (document.getElementById('onboarding-overlay')) return;
        addTourStyles();

        overlay = document.createElement('div');
        overlay.id = 'onboarding-overlay';
        spotlight = document.createElement('div');
        spotlight.id = 'onboarding-spotlight';
        indicator = document.createElement('div');
        indicator.id = 'onboarding-indicator';
        arrow = document.createElement('div');
        arrow.id = 'onboarding-arrow';
        popup = document.createElement('div');
        popup.id = 'onboarding-popup';

        document.body.append(overlay, spotlight, indicator, arrow, popup);
        requestAnimationFrame(() => { overlay.style.opacity = '1'; });
        tourActive = true;

        window.addEventListener('resize', onTourLayoutChange);
        window.addEventListener('scroll', onTourLayoutChange, true);
    }

    function onTourLayoutChange() {
        if (!tourActive) return;
        if (scrollRaf) cancelAnimationFrame(scrollRaf);
        scrollRaf = requestAnimationFrame(() => positionForCurrentTarget());
    }

    function isVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function findTarget(selector) {
        if (!selector) return null;
        const parts = selector.split(',').map(s => s.trim());
        for (const sel of parts) {
            const nodes = document.querySelectorAll(sel);
            for (const el of nodes) {
                if (isVisible(el)) return el;
            }
        }
        return null;
    }

    function ensureSidebarForTarget(target) {
        const sidebar = document.getElementById('mainSidebar');
        if (!sidebar || !target || !sidebar.contains(target)) return;
        if (!isMobile()) return;
        if (window.DashboardSidebar && !window.DashboardSidebar.isOpen()) {
            window.DashboardSidebar.open();
            sidebarWasOpenedByTour = true;
        }
    }

    function restoreSidebarIfNeeded() {
        if (sidebarWasOpenedByTour && window.DashboardSidebar) {
            window.DashboardSidebar.close();
            sidebarWasOpenedByTour = false;
        }
    }

    function positionSpotlight(target) {
        if (!target || !spotlight) return;
        const rect = target.getBoundingClientRect();
        const pad = isMobile() ? 8 : 12;

        spotlight.style.display = 'block';
        spotlight.style.left = Math.max(4, rect.left - pad) + 'px';
        spotlight.style.top = Math.max(4, rect.top - pad) + 'px';
        spotlight.style.width = Math.min(window.innerWidth - 8, rect.width + pad * 2) + 'px';
        spotlight.style.height = Math.min(window.innerHeight - 8, rect.height + pad * 2) + 'px';

        indicator.style.display = 'block';
        indicator.style.left = (rect.left + rect.width / 2 - 12) + 'px';
        indicator.style.top = Math.max(8, rect.top - 36) + 'px';
    }

    function positionPopup(target) {
        if (!popup) return;

        let top, left;
        const popupH = popup.offsetHeight || 280;
        const popupW = popup.offsetWidth || Math.min(400, window.innerWidth - 32);
        const margin = 16;

        if (!target) {
            popup.style.left = '50%';
            popup.style.top = '50%';
            popup.style.transform = 'translate(-50%, -50%)';
            arrow.style.display = 'none';
            return;
        }

        const rect = target.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;

        if (isMobile()) {
            left = margin;
            if (spaceBelow > popupH + 48) {
                top = rect.bottom + 24;
            } else if (spaceAbove > popupH + 48) {
                top = Math.max(margin, rect.top - popupH - 24);
            } else {
                top = Math.max(margin, (window.innerHeight - popupH) / 2);
            }
        } else {
            left = Math.min(Math.max(rect.left, margin), window.innerWidth - popupW - margin);
            if (spaceBelow > popupH + 40) {
                top = rect.bottom + 32;
                arrow.style.display = 'block';
                arrow.style.left = (rect.left + rect.width / 2 - 10) + 'px';
                arrow.style.top = (rect.bottom + 22) + 'px';
            } else {
                top = Math.max(margin, rect.top - popupH - 32);
                arrow.style.display = 'none';
            }
        }

        popup.style.left = left + 'px';
        popup.style.top = top + 'px';
        popup.style.transform = 'none';
    }

    function positionForCurrentTarget() {
        const step = tourSteps[currentStep];
        const target = findTarget(step.target);
        if (target) {
            positionSpotlight(target);
            positionPopup(target);
        }
    }

    function scrollTargetIntoView(target) {
        if (!target) return Promise.resolve();
        return new Promise(resolve => {
            target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            setTimeout(resolve, isMobile() ? 550 : 450);
        });
    }

    function renderStep() {
        const step = tourSteps[currentStep];
        let target = findTarget(step.target);

        popup.style.opacity = '0';
        popup.style.transform = 'translateY(20px)';
        indicator.style.display = 'none';
        arrow.style.display = 'none';

        if (step.target && !target) {
            const fallback = document.querySelector(step.target.split(',')[0].trim());
            if (fallback) target = fallback;
        }

        const finalize = () => {
            if (target) {
                ensureSidebarForTarget(target);
                positionSpotlight(target);
                positionPopup(target);
            } else {
                spotlight.style.display = 'none';
                positionPopup(null);
            }

            popup.style.opacity = '1';
            if (!target) popup.style.transform = 'translate(-50%, -50%)';

            bindPopupActions(step);
        };

        if (target) {
            scrollTargetIntoView(target).then(finalize);
        } else {
            setTimeout(finalize, 80);
        }
    }

    function bindPopupActions(step) {
        const isLast = currentStep === tourSteps.length - 1;
        const progressPct = ((currentStep + 1) / tourSteps.length) * 100;

        popup.innerHTML = `
            <div style="margin-bottom: 1.25rem">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem">
                    <span style="font-size: 0.7rem; font-weight: 800; color: #10b981; text-transform: uppercase; letter-spacing: 0.1em">Etapa ${currentStep + 1} de ${tourSteps.length}</span>
                    <button type="button" id="tour-close-x" style="background: none; border: none; color: rgba(255,255,255,0.3); cursor: pointer; font-size: 1.5rem; line-height: 1">&times;</button>
                </div>
                <div style="height: 4px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden">
                    <div style="width: ${progressPct}%; height: 100%; background: #10b981; transition: width 0.4s ease"></div>
                </div>
            </div>
            <h3 style="color: #fff; font-size: 1.25rem; font-weight: 800; margin-bottom: 0.75rem; letter-spacing: -0.02em">${step.title}</h3>
            <p style="color: rgba(255,255,255,0.65); font-size: 0.92rem; line-height: 1.6; margin-bottom: 1.5rem">${step.content}</p>
            <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap">
                <button type="button" id="tour-skip" class="tour-glass-btn btn-skip-tour">Pular</button>
                <div style="flex: 1"></div>
                ${currentStep > 0 ? '<button type="button" id="tour-back" class="tour-glass-btn btn-back-tour">Voltar</button>' : ''}
                <button type="button" id="tour-next" class="tour-glass-btn btn-next-tour">
                    ${saving ? 'Salvando...' : (isLast ? 'Finalizar' : 'Próximo')}
                </button>
            </div>`;

        document.getElementById('tour-back')?.addEventListener('click', () => {
            currentStep--;
            renderStep();
        });
        document.getElementById('tour-skip')?.addEventListener('click', () => finishTour(false));
        document.getElementById('tour-close-x')?.addEventListener('click', () => finishTour(false));
        document.getElementById('tour-next')?.addEventListener('click', () => {
            if (isLast) finishTour(true);
            else {
                currentStep++;
                renderStep();
            }
        });
    }

    async function finishTour(shouldSave = true) {
        if (saving) return;
        if (shouldSave) {
            saving = true;
            try {
                const apiBase = (window.API_BASE_URL || '/api').replace(/\/$/, '');
                await fetch(`${apiBase}/auth/tutorial`, {
                    method: 'PUT', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tutorialProfessorConcluido: true })
                });
            } catch (e) { console.error('Erro ao salvar tour:', e); }
        }
        destroyUI();
    }

    function destroyUI() {
        restoreSidebarIfNeeded();
        window.removeEventListener('resize', onTourLayoutChange);
        window.removeEventListener('scroll', onTourLayoutChange, true);
        if (scrollRaf) cancelAnimationFrame(scrollRaf);
        [overlay, spotlight, indicator, arrow, popup].forEach(el => el?.remove());
        overlay = spotlight = indicator = arrow = popup = null;
        tourActive = false;
        saving = false;
        sidebarWasOpenedByTour = false;
    }

    async function startTour(force = false) {
        if (tourActive) return;
        try {
            const apiBase = (window.API_BASE_URL || '/api').replace(/\/$/, '');
            const res = await fetch(`${apiBase}/auth/me`, { credentials: 'include' });
            const data = await res.json();
            if (data.success && data.user) {
                if (data.user.perfil === 'responsavel') return;
                if (!force && data.user.tutorialProfessorConcluido) return;

                tourSteps = (data.user.perfil === 'admin' || data.user.perfil === 'diretor') ? DIRECTOR_STEPS : PROFESSOR_STEPS;
                currentStep = 0;
                createUI();
                renderStep();
            }
        } catch (e) { console.error('Erro ao iniciar tour:', e); }
    }

    window.OnboardingTour = {
        start: startTour,
        restart: () => startTour(true),
        finish: () => finishTour(true)
    };

    document.addEventListener('DOMContentLoaded', () => {
        const isDash = window.location.pathname.includes('dashboard.html') || window.location.pathname.endsWith('/');
        if (isDash) setTimeout(() => startTour(false), 2500);
    });
})();
