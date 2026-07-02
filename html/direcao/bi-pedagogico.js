/**
 * BI Pedagógico Premium v3.0
 * Inteligência de Dados com Visualização Avançada
 */

const API_BASE = window.API_BASE_URL || '/api';

const BI_CONFIG = {
    colors: {
        primary: '#6366f1',
        secondary: '#a855f7',
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
        glass: 'rgba(255, 255, 255, 0.1)'
    },
    translations: {
        'Math': 'Matemática',
        'Physics': 'Física',
        'Chemistry': 'Química',
        'History': 'História',
        'Geography': 'Geografia',
        'English': 'Inglês',
        'Biology': 'Biologia',
        'Portuguese': 'Português',
        'Arts': 'Artes',
        'Science': 'Ciências',
        'Physical Education': 'Educação Física'
    }
};

function t(text) {
    return BI_CONFIG.translations[text] || text;
}

let mainCharts = {};
const activeValueAnimations = {};
let isFirstBiLoad = true;

document.addEventListener('DOMContentLoaded', () => {
    initBI();
    setupEventListeners();
});

let biAbortController = null;

async function initBI() {
    if (biAbortController) biAbortController.abort();
    biAbortController = new AbortController();
    const signal = biAbortController.signal;

    try {
        // Carregamento paralelo para melhor performance
        const [heatmapRes, insightsRes, chartDataRes] = await Promise.all([
            fetch(`${API_BASE}/ia/mapa-calor`, {
                signal,
                credentials: 'include'
            }),
            fetch(`${API_BASE}/ia/insights-global`, {
                signal,
                credentials: 'include'
            }).catch(() => null),
            fetch(`${API_BASE}/dashboard/chart-data`, {
                signal,
                credentials: 'include'
            }).catch(() => null)
        ]);

        if (!heatmapRes || !heatmapRes.ok) {
            console.error('Falha ao carregar Mapa de Calor:', heatmapRes?.status);
            showErrorState('heatmapContainer', 'Não foi possível conectar ao servidor de dados.');
        } else {
            const heatmapData = await heatmapRes.json().catch(() => ({ success: false, error: 'Erro ao parsear dados' }));
            console.log('[BI] Heatmap Data Received:', heatmapData);

            if (heatmapData.success && Array.isArray(heatmapData.data) && heatmapData.data.length > 0) {
                renderHeatmap(heatmapData.data);
                renderAnalytics(heatmapData.data);
            } else {
                showErrorState('heatmapContainer', heatmapData.error || 'Sem dados de avaliações disponíveis para o período.');
            }
        }

        if (insightsRes && insightsRes.ok) {
            const resData = await insightsRes.json().catch(() => null);
            if (resData && resData.success && resData.data) {
                renderAIPedagogicalSummary(resData.data);
            } else {
                showSilentError('insightsContainer');
            }
        } else {
            showSilentError('insightsContainer');
            console.warn('Insights IA não disponíveis.');
        }

        if (chartDataRes && chartDataRes.ok) {
            const chartData = await chartDataRes.json().catch(() => null);
            if (chartData && chartData.success && chartData.data && chartData.data.evolucao) {
                renderTrendsChart(chartData.data.evolucao);
            }
        }

        // A animação de entrada (fade-in) só deve rodar uma vez, no primeiro
        // carregamento da página. Repeti-la em toda atualização fazia os
        // cards já visíveis "sumirem" (opacity: 0) antes de reaparecerem.
        if (window.gsap && isFirstBiLoad) {
            animateEntry();
            isFirstBiLoad = false;
        }

    } catch (error) {
        console.error('Erro ao inicializar BI:', error);
        showErrorState('heatmapContainer', `Erro de inicialização: ${error.message}`);
    }
}

function showSilentError(containerId) {
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = '<div style="text-align:center; padding:2rem; opacity:0.5; font-size:0.8rem;">Insights indisponíveis no momento.</div>';
    }
}

/**
 * Exibe estado de erro amigável nos containers
 */
function showErrorState(containerId, message) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = `
        <div style="text-align: center; color: #94a3b8; padding: 3rem 0; border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px;">
            <i class="bi bi-exclamation-triangle" style="font-size: 2rem; display: block; margin-bottom: 1rem; opacity: 0.5;"></i>
            <p style="font-size: 0.9rem;">${message}</p>
        </div>
    `;
}

/**
 * Renderiza o Mapa de Calor (Heatmap)
 */
function renderHeatmap(data) {
    const container = document.getElementById('heatmapContainer');
    if (!container) return;
    if (!Array.isArray(data) || data.length === 0) {
        showErrorState('heatmapContainer', 'Sem registros de avaliação para exibir.');
        return;
    }

    const materias = [...new Set(data.map(d => d.materia))].sort();
    const turmas = [...new Set(data.map(d => d.turma))].sort();

    const dataMap = new Map();
    data.forEach(entry => {
        if (!entry || !entry.materia || !entry.turma) return;
        dataMap.set(`${entry.materia}||${entry.turma}`, entry);
    });

    let html = `<div class="heatmap-grid" style="display: grid; grid-template-columns: 140px repeat(${turmas.length}, minmax(80px, 1fr)); gap: 8px;">`;

    // Header
    html += `<div class="matrix-label-corner"></div>`;
    turmas.forEach(tHead => {
        html += `<div class="matrix-label-h" style="font-weight: 700; color: #94a3b8; text-align: center;">${tHead}</div>`;
    });

    // Rows
    materias.forEach(m => {
        html += `<div class="matrix-label-v-text" style="font-size: 0.75rem; font-weight: 600; display: flex; align-items: center;">${t(m)}</div>`;
        turmas.forEach(tCode => {
            const entry = dataMap.get(`${m}||${tCode}`);
            const media = entry ? parseFloat(entry.media) : 0;
            const totalNotas = entry ? parseInt(entry.totalNotas, 10) || 0 : 0;

            let color = 'rgba(255,255,255,0.03)';
            if (media > 0) {
                if (media < 5.0) { color = 'rgba(239, 68, 68, 0.4)'; } else if (media < 7.5) { color = 'rgba(245, 158, 11, 0.4)'; } else { color = 'rgba(16, 185, 129, 0.4)'; }
            }

            html += `
                <div class="heatmap-cell glass-card" 
                     data-materia="${encodeURIComponent(m)}"
                     data-turma="${encodeURIComponent(tCode)}"
                     data-media="${media}"
                     data-total="${totalNotas}"
                     style="background: ${color}; height: 50px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.85rem; cursor: pointer;"
                >
                    ${media > 0 ? media.toFixed(1) : '-'}
                </div>
            `;
        });
    });

    html += `</div>`;
    container.innerHTML = html;

    container.querySelectorAll('.heatmap-cell').forEach(cell => {
        cell.addEventListener('click', () => {
            const materia = decodeURIComponent(cell.dataset.materia || '');
            const turma = decodeURIComponent(cell.dataset.turma || '');
            const media = parseFloat(cell.dataset.media) || 0;
            const total = parseInt(cell.dataset.total, 10) || 0;
            showCellDetails(materia, turma, media, total);
        });
    });
}

/**
 * Gráficos e Analíticos Adicionais
 */
function renderAnalytics(data) {
    // 1. KPI Update
    if (!data || data.length === 0) return;
    const validMedia = data.map(item => parseFloat(item.media)).filter(value => !Number.isNaN(value));
    const totalMedia = validMedia.length ? validMedia.reduce((a, b) => a + b, 0) / validMedia.length : 0;
    const displayedMedia = totalMedia.toFixed(1);

    animateValue('kpiMedia', 0, displayedMedia, 1500);

    // Dynamic Trend (Simple mock for now based on media)
    const trendEl = document.querySelector('.kpi-trend');
    if (trendEl) {
        if (totalMedia >= 7) {
            trendEl.style.color = 'var(--bi-success)';
            trendEl.innerHTML = '<i class="bi bi-caret-up-fill"></i> Estável / Positivo';
        } else {
            trendEl.style.color = 'var(--bi-danger)';
            trendEl.innerHTML = '<i class="bi bi-caret-down-fill"></i> Requer Atenção';
        }
    }

    // 2. Radar Chart - Distribuição por Matéria
    const materiaAgrupada = {};
    data.forEach(d => {
        if (!materiaAgrupada[d.materia]) materiaAgrupada[d.materia] = { soma: 0, count: 0 };
        materiaAgrupada[d.materia].soma += parseFloat(d.media);
        materiaAgrupada[d.materia].count++;
    });

    const radarLabels = Object.keys(materiaAgrupada);
    const radarLabelsTranslated = radarLabels.map(l => t(l));
    const radarValues = radarLabels.map(m => (materiaAgrupada[m].soma / materiaAgrupada[m].count).toFixed(1));

    const ctxRadar = document.getElementById('subjectRadarChart');
    if (ctxRadar) {
        if (mainCharts.radar) mainCharts.radar.destroy();
        mainCharts.radar = new Chart(ctxRadar, {
            type: 'radar',
            data: {
                labels: radarLabelsTranslated,
                datasets: [{
                    label: 'Média Global',
                    data: radarValues,
                    borderColor: BI_CONFIG.colors.primary,
                    backgroundColor: 'rgba(99, 102, 241, 0.2)',
                    pointBackgroundColor: BI_CONFIG.colors.primary,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    r: {
                        angleLines: { color: 'rgba(255,255,255,0.1)' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        ticks: { display: false },
                        suggestedMin: 0,
                        suggestedMax: 10
                    }
                },
                plugins: { legend: { display: false } }
            }
        });
    }
}

/**
 * Renderiza o Sumário Pedagógico da IA
 */
function renderAIPedagogicalSummary(data) {
    const container = document.getElementById('insightsContainer');
    if (!container || !data.sumario) return;

    container.innerHTML = `
        <div class="insight-summary glass-card animate-fade-in" style="padding: 1.5rem; border-left: 4px solid var(--bi-accent);">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                <span style="font-size: 0.75rem; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Relatório Narrativo</span>
                <button type="button" id="btn-vocalize-insights" class="voice-btn-mini" title="Ouvir análise da IA">
                    <i class="bi bi-volume-up-fill"></i>
                </button>
            </div>
            
            <div class="summary-text" style="color: #cbd5e1; font-size: 0.95rem; line-height: 1.6; font-weight: 400;">
                ${data.sumario.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #fff;">$1</strong>')}
            </div>

            <div style="margin-top: 1.5rem; display: flex; gap: 10px; flex-wrap: wrap;">
                <div class="badge-mini" title="Média Global"><i class="bi bi-graph-up"></i> ${data.mediaEscola || '0'}</div>
                <div class="badge-mini" title="Alunos em Risco"><i class="bi bi-people"></i> ${data.alunosRisco || 0}</div>
                <div class="badge-mini" title="Matéria Crítica"><i class="bi bi-journal-x"></i> ${data.materiaCritica || 'N/A'}</div>
            </div>
        </div>
    `;

    // Event Listener para Vocalização (Integrado com VoiceOrb)
    document.getElementById('btn-vocalize-insights')?.addEventListener('click', async function() {
        if (!window.speak) return;

        const cleanText = data.sumario.replace(/\*\*/g, '');
        const localOrb = document.getElementById('bi-ai-orb-container');

        // Prepara o listener de fim ANTES de iniciar a fala,
        // para nunca perder o evento caso o áudio seja muito curto.
        const hideOrb = () => {
            if (window.VoiceOrbManager) {
                window.VoiceOrbManager.setState('idle');
                setTimeout(() => {
                    if (localOrb) localOrb.style.display = 'none';
                    window.VoiceOrbManager.destroy();
                }, 2000);
            }
        };
        window.addEventListener('tts:ended', hideOrb, { once: true });

        try {
            // window.speak retorna o objeto Audio quando o áudio começa a tocar.
            // Só ativamos o orb SE o áudio foi obtido com sucesso.
            const audio = await window.speak(cleanText);

            if (audio && window.VoiceOrbManager && localOrb) {
                localOrb.style.display = 'block';
                localOrb.innerHTML = '';
                window.VoiceOrbManager.init(localOrb, { mode: 'chat' });
                window.VoiceOrbManager.setState('speaking');
            }
        } catch (err) {
            console.warn('[BI] Falha na vocalização dos insights:', err.message);
            // Garante que o orb é escondido mesmo em caso de erro
            window.removeEventListener('tts:ended', hideOrb);
            hideOrb();
        }
    });
}

function renderTrendsChart(evolucaoData) {
    const ctxTrend = document.getElementById('trendsChart');
    if (!ctxTrend || !evolucaoData || evolucaoData.length === 0) return;

    const labels = evolucaoData.map(item => item.label);
    const dataPoints = evolucaoData.map(item => item.value !== null ? parseFloat(item.value) : null);

    // Se todos os valores são nulos, não há dados para exibir
    if (dataPoints.every(v => v === null)) {
        const parent = ctxTrend.parentElement;
        if (parent) parent.innerHTML = '<div style="text-align:center; padding:2rem; opacity:0.5; font-size:0.85rem; color:#94a3b8;">Sem avaliações registradas por bimestre ainda.</div>';
        return;
    }

    if (mainCharts.trend) mainCharts.trend.destroy();
    mainCharts.trend = new Chart(ctxTrend, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Média Geral',
                data: dataPoints,
                borderColor: BI_CONFIG.colors.success,
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 3,
                pointRadius: 4,
                pointBackgroundColor: '#fff',
                spanGaps: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    border: { display: false },
                    ticks: { color: '#64748b' },
                    suggestedMin: 0,
                    suggestedMax: 10
                },
                x: { grid: { display: false }, border: { display: false }, ticks: { color: '#64748b' } }
            }
        }
    });
}

/**
 * Helpers
 */
function getInsightColor(type) {
    return { positive: '#10b981', warning: '#f59e0b', critical: '#ef4444' }[type] || '#fff';
}

function getInsightIcon(type) {
    return { positive: 'bi-check-circle-fill', warning: 'bi-exclamation-triangle-fill', critical: 'bi-x-circle-fill' }[type] || 'bi-info-circle-fill';
}

function showCellDetails(materia, turma, media, total) {
    // Busca dados em tempo real ao abrir o card
    const nomeMateria = t(materia);
    const mediaNum = typeof media === 'number' ? media : parseFloat(media) || 0;
    const totalNum = typeof total === 'number' ? total : parseInt(total) || 0;

    // Cor da média baseada no desempenho
    let mediaColor = '#10b981';
    if (mediaNum > 0 && mediaNum < 5.0) mediaColor = '#ef4444';
    else if (mediaNum >= 5.0 && mediaNum < 7.5) mediaColor = '#f59e0b';

    Swal.fire({
        title: `${nomeMateria} — Turma ${turma}`,
        html: `
            <div style="text-align: left; padding: 12px 4px;">
                <div style="display: flex; gap: 16px; margin-bottom: 16px;">
                    <div style="flex: 1; background: rgba(255,255,255,0.04); border-radius: 10px; padding: 14px; text-align: center;">
                        <div style="font-size: 0.7rem; color: #64748b; font-weight: 700; text-transform: uppercase; margin-bottom: 6px;">Média Atual</div>
                        <div style="font-size: 2rem; font-weight: 800; color: ${mediaColor};">${mediaNum > 0 ? mediaNum.toFixed(1) : '—'}</div>
                    </div>
                    <div style="flex: 1; background: rgba(255,255,255,0.04); border-radius: 10px; padding: 14px; text-align: center;">
                        <div style="font-size: 0.7rem; color: #64748b; font-weight: 700; text-transform: uppercase; margin-bottom: 6px;">Total de Avaliações</div>
                        <div style="font-size: 2rem; font-weight: 800; color: #fff;">${totalNum}</div>
                    </div>
                </div>
                <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 12px 0;">
                <p style="font-size: 0.78rem; color: #64748b; margin: 0; display: flex; align-items: center; gap: 6px;">
                    <i class="bi bi-clock" style="color: #10b981;"></i>
                    Dados carregados em tempo real do banco de dados.
                </p>
            </div>
        `,
        background: '#0f172a',
        color: '#fff',
        confirmButtonColor: '#6366f1',
        confirmButtonText: 'Fechar'
    });
}

function animateValue(id, start, end, duration) {
    const obj = document.getElementById(id);
    if (!obj) return;

    // Cancela qualquer animação anterior ainda rodando neste mesmo elemento,
    // evitando que duas animações sobrepostas (ex: cliques rápidos em
    // "Atualizar Dados") escrevam valores divergentes no innerHTML.
    if (activeValueAnimations[id]) {
        window.cancelAnimationFrame(activeValueAnimations[id]);
        activeValueAnimations[id] = null;
    }

    const startNum = parseFloat(start);
    const endNum = parseFloat(end);
    let startTimestamp = null;

    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = (progress * (endNum - startNum) + startNum).toFixed(1);
        if (progress < 1) {
            activeValueAnimations[id] = window.requestAnimationFrame(step);
        } else {
            activeValueAnimations[id] = null;
        }
    };
    activeValueAnimations[id] = window.requestAnimationFrame(step);
}

// GSAP entry animation check
function animateEntry() {
    // Animamos apenas os cards principais do layout, ignorando as dezenas de células dinâmicas do heatmap e resumos internos da IA
    gsap.from(".glass-card:not(.heatmap-cell):not(.insight-summary)", {
        duration: 0.6,
        y: 20,
        opacity: 0,
        stagger: 0.06,
        ease: "power2.out",
        clearProps: "all" // Garante a remoção de estilos inline (como opacity e transform) após a animação terminar
    });
}

function setupEventListeners() {
    // Smart Refresh
    const btnRefresh = document.getElementById('btnAtualizarBI');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', async() => {
            const originalContent = btnRefresh.innerHTML;
            btnRefresh.disabled = true;
            btnRefresh.innerHTML = '<i class="bi bi-arrow-clockwise animate-spin" style="display:inline-block; animation: spin 1s linear infinite;"></i> Atualizando...';

            await initBI();

            setTimeout(() => {
                btnRefresh.disabled = false;
                btnRefresh.innerHTML = originalContent;
                if (window.showToast) {
                    window.showToast('Dados pedagógicos sincronizados!', 'success');
                } else if (Swal) {
                    Swal.fire({
                        toast: true,
                        position: 'top-end',
                        icon: 'success',
                        title: 'BI Atualizado',
                        showConfirmButton: false,
                        timer: 3000,
                        background: '#1e293b',
                        color: '#fff'
                    });
                }
            }, 800);
        });
    }

    // Relatório Completo - Conectado ao endpoint real
    const btnRelatorio = document.getElementById('btnRelatorioBI');
    if (btnRelatorio) {
        btnRelatorio.addEventListener('click', () => {
            Swal.fire({
                title: 'Gerando Relatório BI',
                text: 'Processando matriz de desempenho global...',
                icon: 'info',
                background: '#0f172a',
                color: '#fff',
                showConfirmButton: false,
                timer: 1500,
                timerProgressBar: true,
                didOpen: () => {
                    Swal.showLoading();
                }
            }).then(() => {
                // Abre o endpoint de geração de PDF em nova aba
                window.open(`${API_BASE}/ia/relatorio-bi`, '_blank');
            });
        });
    }

    // --- RESPONSIVE SIDEBAR TOGGLE LOGIC ---
    const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    const sidebar = document.getElementById('bi-sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    const toggleSidebar = () => {
        if (!sidebar || !overlay) return;
        sidebar.classList.toggle('active');
        overlay.classList.toggle('active');
    };

    const closeSidebar = () => {
        if (!sidebar || !overlay) return;
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
    };

    if (btnToggleSidebar) {
        btnToggleSidebar.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSidebar();
        });
    }

    if (overlay) {
        overlay.addEventListener('click', closeSidebar);
    }

    // Auto-close sidebar on window resize to desktop
    window.addEventListener('resize', () => {
        if (window.innerWidth > 1024) {
            closeSidebar();
        }
    });

    // Close on Escape key press
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSidebar();
        }
    });

    // --- ACCESSIBILITY/VOICE PANEL TOGGLE LOGIC ---
    const btnVoiceSettings = document.getElementById('btn-voice-settings');
    const voicePanel = document.getElementById('voice-settings-panel');

    if (btnVoiceSettings && voicePanel) {
        btnVoiceSettings.addEventListener('click', (e) => {
            e.stopPropagation();
            const isActive = voicePanel.classList.toggle('active');
            document.body.classList.toggle('no-scroll', isActive);
            if (isActive) {
                voicePanel.querySelector('select, button')?.focus();
            }
        });

        // Close voice settings when clicking outside
        document.addEventListener('click', (e) => {
            if (!voicePanel.contains(e.target) && e.target !== btnVoiceSettings) {
                voicePanel.classList.remove('active');
                document.body.classList.remove('no-scroll');
            }
        });

        // Close voice panel with Escape key when open
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && voicePanel.classList.contains('active')) {
                voicePanel.classList.remove('active');
                document.body.classList.remove('no-scroll');
            }
        });
    }

    // Close on Escape key press
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            voicePanel.classList.remove('active');
        }
    });
}
}