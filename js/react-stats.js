/**
 * react-stats.js — Componente React com Framer Motion
 * Painel de Estatísticas Animado do Dashboard
 *
 * Monta em: <div id="react-stats-panel"></div>
 * Dependências (já carregadas via CDN no dashboard.html):
 *   - React 18 (window.React)
 *   - ReactDOM 18 (window.ReactDOM)
 *   - Framer Motion (window.Motion)
 */

(function () {
    'use strict';

    // Aguarda React e Framer Motion estarem disponíveis
    function waitForLibs(callback) {
        if (window.React && window.ReactDOM && window.Motion) {
            callback();
        } else {
            setTimeout(function () { waitForLibs(callback); }, 80);
        }
    }

    waitForLibs(function () {
        const { createElement: h, useState, useEffect, useRef } = window.React;
        const { createRoot } = window.ReactDOM;
        const { motion, AnimatePresence } = window.Motion;

        // ─── Hook: anima número de 0 até valor final ────────────────────────
        function useCountUp(target, duration) {
            const [count, setCount] = useState(0);
            const started = useRef(false);

            useEffect(function () {
                if (started.current || target === null || target === undefined) return;
                started.current = true;

                const start = performance.now();
                function step(now) {
                    const progress = Math.min((now - start) / (duration * 1000), 1);
                    // easeOutExpo
                    const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
                    setCount(Math.floor(eased * target));
                    if (progress < 1) requestAnimationFrame(step);
                }
                requestAnimationFrame(step);
            }, [target]);

            return count;
        }

        // ─── Componente: um card de estatística ─────────────────────────────
        function StatCard({ icon, label, value, suffix, color, delay, href }) {
            const displayValue = useCountUp(typeof value === 'number' ? value : 0, 1.4);

            const cardContent = h(motion.div, {
                className: 'react-stat-card',
                initial: { opacity: 0, y: 30, scale: 0.92 },
                animate: { opacity: 1, y: 0, scale: 1 },
                transition: { duration: 0.5, delay: delay, ease: [0.22, 1, 0.36, 1] },
                whileHover: { y: -6, scale: 1.03, transition: { duration: 0.2 } },
                style: {
                    background: 'rgba(255,255,255,0.04)',
                    backdropFilter: 'blur(16px)',
                    WebkitBackdropFilter: 'blur(16px)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '16px',
                    padding: '1.25rem 1.5rem',
                    cursor: href ? 'pointer' : 'default',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                    position: 'relative',
                    overflow: 'hidden',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
                    minWidth: '140px',
                    flex: '1 1 140px',
                }
            },
                // Glow de fundo colorido
                h('div', {
                    style: {
                        position: 'absolute',
                        inset: 0,
                        background: `radial-gradient(circle at 30% 50%, ${color}22 0%, transparent 70%)`,
                        pointerEvents: 'none',
                    }
                }),
                // Ícone
                h('div', {
                    style: {
                        width: '40px', height: '40px',
                        borderRadius: '12px',
                        background: `${color}22`,
                        border: `1px solid ${color}44`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '1.2rem',
                        color: color,
                    }
                }, h('i', { className: icon })),
                // Valor animado
                h('div', {
                    style: {
                        fontSize: '2rem',
                        fontWeight: '800',
                        color: '#f1f5f9',
                        lineHeight: 1,
                        fontVariantNumeric: 'tabular-nums',
                    }
                },
                    typeof value === 'number' ? displayValue + (suffix || '') : (value || '—')
                ),
                // Label
                h('div', {
                    style: {
                        fontSize: '0.78rem',
                        color: '#64748b',
                        fontWeight: 500,
                        letterSpacing: '0.02em',
                    }
                }, label)
            );

            if (href) {
                return h('a', { href, style: { textDecoration: 'none' } }, cardContent);
            }
            return cardContent;
        }

        // ─── Componente raiz: painel de estatísticas ────────────────────────
        function StatsPanel() {
            const [stats, setStats] = useState(null);
            const [loading, setLoading] = useState(true);

            useEffect(function () {
                // Busca os dados reais do backend (mesmo endpoint do dashboard.js)
                async function fetchStats() {
                    try {
                        const baseUrl = window.API_BASE_URL ||
                            ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                                ? 'http://localhost:3001/api'
                                : 'https://sistema-escolar-bfty.onrender.com/api');

                        const res = await fetch(`${baseUrl}/dashboard/summary`, {
                            credentials: 'include'
                        });
                        const data = await res.json();
                        if (data.success) setStats(data.data);
                    } catch (e) {
                        // Se falhar (ex: não logado), usa placeholders
                        setStats({ alunos: null, professores: null, turmas: null, faltas: null });
                    } finally {
                        setLoading(false);
                    }
                }
                fetchStats();
            }, []);

            const cards = [
                {
                    icon: 'bi bi-people-fill',
                    label: 'Alunos Matriculados',
                    value: stats?.alunos ?? stats?.totalAlunos ?? null,
                    color: '#6366f1',
                    delay: 0,
                    href: 'detalhes/alunos.html',
                },
                {
                    icon: 'bi bi-person-badge-fill',
                    label: 'Professores Ativos',
                    value: stats?.professores ?? stats?.totalProfessores ?? null,
                    color: '#22c55e',
                    delay: 0.1,
                    href: 'lista-professores.html',
                },
                {
                    icon: 'bi bi-door-open-fill',
                    label: 'Turmas Abertas',
                    value: stats?.turmas ?? stats?.totalTurmas ?? null,
                    color: '#f59e0b',
                    delay: 0.2,
                    href: null,
                },
                {
                    icon: 'bi bi-calendar-x-fill',
                    label: 'Faltas este Mês',
                    value: stats?.faltas ?? stats?.faltasHoje ?? null,
                    color: '#ef4444',
                    delay: 0.3,
                    href: 'frequencia-professores.html',
                },
            ];

            return h('div', {
                style: {
                    margin: '1.5rem 0 2rem',
                }
            },
                // Título da seção
                h(motion.div, {
                    initial: { opacity: 0, x: -20 },
                    animate: { opacity: 1, x: 0 },
                    transition: { duration: 0.4, ease: 'easeOut' },
                    style: {
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        marginBottom: '1rem',
                    }
                },
                    h('i', { className: 'bi bi-bar-chart-fill', style: { color: '#6366f1', fontSize: '1rem' } }),
                    h('span', {
                        style: {
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            color: '#64748b',
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                        }
                    }, 'Resumo Geral')
                ),
                // Grid de cards
                loading
                    ? h('div', {
                        style: {
                            display: 'flex', gap: '1rem', flexWrap: 'wrap',
                        }
                    },
                        [0, 1, 2, 3].map(function (i) {
                            return h(motion.div, {
                                key: i,
                                animate: { opacity: [0.4, 0.8, 0.4] },
                                transition: { duration: 1.5, repeat: Infinity, delay: i * 0.15 },
                                style: {
                                    flex: '1 1 140px', minWidth: '140px', height: '110px',
                                    borderRadius: '16px',
                                    background: 'rgba(255,255,255,0.04)',
                                    border: '1px solid rgba(255,255,255,0.06)',
                                }
                            });
                        })
                    )
                    : h(AnimatePresence, null,
                        h('div', {
                            style: { display: 'flex', gap: '1rem', flexWrap: 'wrap' }
                        },
                            cards.map(function (card, i) {
                                return h(StatCard, Object.assign({ key: i }, card));
                            })
                        )
                    )
            );
        }

        // ─── Monta no DOM após ele estar pronto ─────────────────────────────
        function mount() {
            const container = document.getElementById('react-stats-panel');
            if (!container) return;
            const root = createRoot(container);
            root.render(h(StatsPanel, null));
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', mount);
        } else {
            mount();
        }
    });
})();
