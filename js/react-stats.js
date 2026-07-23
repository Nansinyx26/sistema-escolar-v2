/**
 * react-stats.js — Componente React com Framer Motion
 * Painel de Estatísticas Animado do Dashboard
 *
 * Monta em: <div id="react-stats-panel"></div>
 */

(function () {
    'use strict';

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

        function useCountUp(target, duration) {
            const [count, setCount] = useState(0);
            const started = useRef(false);

            useEffect(function () {
                if (started.current || target === null || target === undefined) return;
                started.current = true;
                const start = performance.now();
                function step(now) {
                    const progress = Math.min((now - start) / (duration * 1000), 1);
                    const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
                    setCount(Math.floor(eased * target));
                    if (progress < 1) requestAnimationFrame(step);
                }
                requestAnimationFrame(step);
            }, [target]);

            return count;
        }

        // --- ADMIN / DIRECTOR PANEL ---
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
                    display: 'flex', flexDirection: 'column', gap: '0.5rem',
                    position: 'relative', overflow: 'hidden',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
                    minWidth: '220px', flex: '1 1 220px',
                }
            },
                h('div', { style: { position: 'absolute', inset: 0, background: `radial-gradient(circle at 30% 50%, ${color}22 0%, transparent 70%)`, pointerEvents: 'none' } }),
                h('div', { style: { width: '40px', height: '40px', borderRadius: '12px', background: `${color}22`, border: `1px solid ${color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', color: color } }, h('i', { className: icon })),
                h('div', { style: { fontSize: '2rem', fontWeight: '800', color: '#f1f5f9', lineHeight: 1, fontVariantNumeric: 'tabular-nums' } }, typeof value === 'number' ? displayValue + (suffix || '') : (value || '—')),
                h('div', { style: { fontSize: '0.78rem', color: '#64748b', fontWeight: 500, letterSpacing: '0.02em' } }, label)
            );
            if (href) return h('a', { href, style: { textDecoration: 'none' } }, cardContent);
            return cardContent;
        }

        function StatsPanel() {
            const [stats, setStats] = useState(null);
            const [loading, setLoading] = useState(true);

            useEffect(function () {
                async function fetchStats() {
                    try {
                        const baseUrl = window.API_BASE_URL || (window.location.hostname === 'localhost' ? `http://${window.location.hostname}:3001/api` : 'https://sistema-escolar-bfty.onrender.com/api');
                        const res = await fetch(`${baseUrl}/dashboard/summary`, { credentials: 'include' });
                        const data = await res.json();
                        if (data.success) setStats(data.data);
                    } catch (e) {
                        setStats({ alunos: null, professores: null, turmas: null, faltas: null });
                    } finally {
                        setLoading(false);
                    }
                }
                fetchStats();
            }, []);

            const cards = [
                { icon: 'bi bi-people-fill', label: 'Alunos Matriculados', value: stats?.alunos ?? stats?.totalAlunos ?? null, color: '#6366f1', delay: 0, href: 'detalhes/alunos.html' },
                { icon: 'bi bi-person-badge-fill', label: 'Professores Ativos', value: stats?.professores ?? stats?.totalProfessores ?? null, color: '#22c55e', delay: 0.1, href: 'lista-professores.html' },
                { icon: 'bi bi-door-open-fill', label: 'Turmas Abertas', value: stats?.turmas ?? stats?.totalTurmas ?? null, color: '#f59e0b', delay: 0.2, href: null },
            ];

            return h('div', { style: { margin: '1.5rem 0 2rem' } },
                h(motion.div, { initial: { opacity: 0, x: -20 }, animate: { opacity: 1, x: 0 }, transition: { duration: 0.4, ease: 'easeOut' }, style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' } },
                    h('i', { className: 'bi bi-bar-chart-fill', style: { color: '#6366f1', fontSize: '1rem' } }),
                    h('span', { style: { fontSize: '0.8rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' } }, 'Resumo Geral')
                ),
                loading ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' } }, [0, 1, 2].map(i => h(motion.div, { key: i, animate: { opacity: [0.4, 0.8, 0.4] }, transition: { duration: 1.5, repeat: Infinity, delay: i * 0.15 }, style: { height: '110px', borderRadius: '16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' } }))) : h(AnimatePresence, null, h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' } }, cards.map((card, i) => h(StatCard, Object.assign({ key: i }, card)))))
            );
        }

        // --- TEACHER PANEL (PAINEL DO DOCENTE) ---
        function TeacherPanel() {
            const [data, setData] = useState(null);
            const [loading, setLoading] = useState(true);
            const [currentTime, setCurrentTime] = useState('');

            useEffect(() => {
                async function fetchTeacherData() {
                    try {
                        const baseUrl = window.API_BASE_URL || (window.location.hostname === 'localhost' ? `http://${window.location.hostname}:3001/api` : 'https://sistema-escolar-bfty.onrender.com/api');
                        const res = await fetch(`${baseUrl}/dashboard/teacher-panel`, { credentials: 'include' });
                        const json = await res.json();
                        if (json.success) setData(json.data);
                    } catch (e) {
                        console.error(e);
                    } finally {
                        setLoading(false);
                    }
                }
                fetchTeacherData();
                const interval = setInterval(fetchTeacherData, 60000);
                return () => clearInterval(interval);
            }, []);

            useEffect(() => {
                function updateClock() {
                    const brTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
                    const hrs = String(brTime.getHours()).padStart(2, '0');
                    const mins = String(brTime.getMinutes()).padStart(2, '0');
                    const secs = String(brTime.getSeconds()).padStart(2, '0');
                    setCurrentTime(`${hrs}:${mins}:${secs}`);
                }
                updateClock();
                const interval = setInterval(updateClock, 1000);
                return () => clearInterval(interval);
            }, []);

            if (loading) {
                return h('div', { style: { color: '#94a3b8', padding: '2rem', textAlign: 'center' } }, 'Carregando painel do docente...');
            }

            if (!data) return null;

            const getSubjectIcon = (materia) => {
                const mat = (materia || '').toUpperCase();
                if (mat.includes('PLANEJAMENTO')) return 'bi-calendar2-range-fill';
                if (mat.includes('REUNIÃO') || mat.includes('REUNIAO') || mat.includes('PEDAGÓGICA') || mat.includes('PEDAGOGICA')) return 'bi-people-fill';
                if (mat.includes('ARTES') || mat.includes('ARTE')) return 'bi-palette-fill';
                if (mat.includes('INGLÊS') || mat.includes('INGLES')) return 'bi-translate';
                if (mat.includes('MAKER')) return 'bi-cpu-fill';
                if (mat.includes('LEITURA')) return 'bi-book-half';
                if (mat.includes('FÍSICA') || mat.includes('FISICA') || mat.includes('ED. FÍSICA') || mat.includes('ED. FISICA') || mat.includes('EF ')) return 'bi-dribbble';
                if (mat.includes('SEBRAE') || mat.includes('DSE') || mat.includes('EMPREENDEDORISMO')) return 'bi-briefcase-fill';
                if (mat.includes('PROERD')) return 'bi-shield-fill-check';
                return 'bi-journal-text';
            };

            return h(motion.div, {
                className: 'how-visual',
                initial: { opacity: 0, y: 20 },
                animate: { opacity: 1, y: 0 },
                transition: { duration: 0.5 }
            },
                h('div', { className: 'hv-head', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' } },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                        h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' } }),
                        h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', display: 'inline-block' } }),
                        h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'inline-block' } }),
                        h('span', { className: 'hv-title', style: { marginLeft: '6px', fontWeight: 600, color: 'rgba(255,255,255,0.7)' } }, `PAINEL DO DOCENTE — HOJE`)
                    ),
                    h('span', { className: 'hv-live-badge', style: { background: 'rgba(16, 184, 168, 0.08)', border: '1px solid rgba(16, 184, 168, 0.2)', padding: '4px 10px', borderRadius: '30px', display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.7rem', color: '#10b8a8', fontWeight: '600', letterSpacing: '0.03em' } }, 
                        h('span', { className: 'hv-live-dot' }), 
                        `AO VIVO · BRASIL: ${currentTime}`
                    )
                ),
                h('div', { style: { padding: '1.5rem 1.5rem 1.25rem' } },
                    h('h2', { style: { fontFamily: 'var(--r, "Inter")', fontSize: '2.8rem', fontWeight: '400', margin: '0 0 0.25rem 0', color: '#ffffff', letterSpacing: '-0.01em' } }, `${data.saudacao || 'Bom dia'}, Prof. ${data.nomeProfessor.split(' ')[0]}`),
                    h('div', { style: { fontFamily: 'var(--m, "JetBrains Mono")', fontSize: '0.82rem', color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 } }, `${data.diaSemana.toUpperCase()}  ·  ${data.turmaLabel || 'SEM TURMAS'}`)
                ),
                h('div', { className: 'hv-mini-grid' },
                    h('div', { className: 'hv-cell', style: { position: 'relative', overflow: 'hidden' } },
                        h('i', { className: 'bi bi-calendar-check-fill', style: { position: 'absolute', right: '12px', top: '12px', fontSize: '1.1rem', color: 'rgba(16, 184, 168, 0.15)' } }),
                        h('div', { className: 'hv-n hv-n-t' }, data.frequencia > 0 ? [data.frequencia, h('span', { key: 'pct', style: { fontSize: '1.2rem', marginLeft: '2px', verticalAlign: 'middle', opacity: 0.8 } }, '%')] : '—'),
                        h('div', { className: 'hv-l' }, 'Frequência')
                    ),
                    h('div', { className: 'hv-cell', style: { position: 'relative', overflow: 'hidden' } },
                        h('i', { className: 'bi bi-journal-check', style: { position: 'absolute', right: '12px', top: '12px', fontSize: '1.1rem', color: 'rgba(61, 143, 212, 0.15)' } }),
                        h('div', { className: 'hv-n hv-n-b' }, data.mediaGeral > 0 ? data.mediaGeral : '—'),
                        h('div', { className: 'hv-l' }, 'Média Geral')
                    ),
                    h('div', { className: 'hv-cell', style: { position: 'relative', overflow: 'hidden' } },
                        h('i', { className: 'bi bi-megaphone-fill', style: { position: 'absolute', right: '12px', top: '12px', fontSize: '1.1rem', color: 'rgba(226, 199, 106, 0.12)' } }),
                        h('div', { className: 'hv-n hv-n-g' }, data.avisosAtivos),
                        h('div', { className: 'hv-l' }, 'Aviso Ativo')
                    )
                ),
                h('div', { className: 'hv-schedule' },
                    h('div', { className: 'hv-sch-head' }, `CRONOGRAMA DE HOJE — ${data.turmaLabel || 'GERAL'}`),
                    data.proximasAulas.length === 0
                        ? h('div', { style: { color: '#64748b', padding: '2rem 1.5rem', fontSize: '0.85rem' } }, 'Nenhuma aula agendada para hoje.')
                        : data.proximasAulas.map((aula, i) => {
                            let salaLabel = aula.sala || 'Sala de Aula';
                            if (!aula.sala) {
                                if (aula.materia.includes('Pedagógica') || aula.materia.includes('pedagógica')) {
                                    salaLabel = 'Biblioteca';
                                } else if (aula.turma && (aula.turma.includes('1C') || aula.turma.includes('1ºC'))) {
                                    salaLabel = 'Sala 03';
                                } else if (aula.turma && aula.turma.includes('9º')) {
                                    salaLabel = 'Sala 12';
                                } else if (aula.turma && aula.turma.includes('8º')) {
                                    salaLabel = 'Sala 07';
                                } else if (aula.turma && aula.turma.includes('7º')) {
                                    salaLabel = 'Sala 03';
                                }
                            }
                            
                            const isMeeting = aula.materia.includes('Reunião') || aula.materia.includes('reunião') || aula.materia.includes('Pedagógica') || aula.materia.includes('pedagógica');
                            const isPlanning = aula.materia.includes('Planejamento') || aula.materia.includes('planejamento');
                            
                            let statusClass = 'futura';
                            if (aula.status === 'Agora') {
                                statusClass = 'agora';
                            } else if (aula.status === 'Concluída') {
                                statusClass = 'concluida';
                            }

                            const periodLabel = isMeeting 
                                ? 'Extra' 
                                : (isPlanning ? 'Planejamento' : `${i + 1}ª Aula`);
                            
                            const subjectIcon = getSubjectIcon(aula.materia);

                            return h('div', { 
                                className: `hv-row status-${statusClass} ${isPlanning ? 'status-planejamento' : ''}`, 
                                key: i 
                            },
                                h('div', { className: 'hv-row-icon-wrap' }, 
                                    h('i', { className: `bi ${subjectIcon}` })
                                ),
                                h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.15rem', flex: 1 } },
                                    h('div', { className: 'hv-rname', style: { display: 'flex', alignItems: 'center', gap: '6px' } }, 
                                        aula.materia,
                                        statusClass === 'concluida' && h('i', { className: 'bi bi-check-circle-fill', style: { color: '#10b8a8', fontSize: '0.85rem' } })
                                    ),
                                    h('div', { className: 'hv-rmeta' }, 
                                        h('span', { style: { color: isPlanning ? 'rgba(255,255,255,0.4)' : '#60a5fa', fontWeight: '600', marginRight: '6px' } }, periodLabel),
                                        ` ·  ${aula.horarioRange || aula.hora}  ·  ${salaLabel}`
                                    )
                                ),
                                h('div', { className: `hv-rbadge ${aula.statusColor || 'badge-normal'}` }, 
                                    statusClass === 'agora' && h('span', { className: 'hv-live-dot', style: { width: '4px', height: '4px', marginRight: '4px', verticalAlign: 'middle' } }),
                                    aula.status
                                )
                            );
                        })
                ),
                h('div', { className: 'hv-schedule', style: { paddingTop: '0', paddingBottom: '1rem' } },
                    h('div', { className: 'hv-sch-head' }, 'FREQUÊNCIA DOS ALUNOS'),
                    data.frequenciaPorTurma.length === 0
                        ? h('div', { style: { color: '#64748b', padding: '1rem 1.5rem', fontSize: '0.85rem' } }, 'Nenhum dado de frequência disponível.')
                        : data.frequenciaPorTurma.map((t, i) => h('div', { className: 'hv-progress-container', key: i },
                            h('div', { className: 'hv-progress-header' }, h('span', null, t.nome), h('span', null, `${t.porcentagem}%`)),
                            h('div', { className: 'hv-progress-bar-bg' },
                                h(motion.div, { 
                                    className: 'hv-progress-bar-fill', 
                                    initial: { width: 0 }, 
                                    animate: { width: `${t.porcentagem}%` }, 
                                    transition: { duration: 1, delay: 0.5 },
                                    style: { background: i === 0 ? 'var(--a)' : i === 1 ? 'var(--blue)' : 'var(--purple)' }
                                })
                            )
                        ))
                ),
                h('div', { 
                    style: { 
                        margin: '0 1.5rem 1.5rem', 
                        padding: '1rem 1.25rem', 
                        background: 'rgba(16, 184, 168, 0.04)', 
                        backdropFilter: 'blur(8px)',
                        border: '1px solid rgba(16, 184, 168, 0.15)', 
                        borderRadius: '12px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '0.75rem',
                        boxShadow: '0 4px 16px rgba(16, 184, 168, 0.05)'
                    } 
                },
                    h('i', { className: 'bi bi-bell-fill', style: { fontSize: '1rem', color: 'var(--a)', animation: 'hv-pulse 2s infinite ease-in-out' } }),
                    h('div', { style: { fontSize: '.85rem', color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 } }, 
                        h('span', { style: { color: 'var(--a2)', fontWeight: 600 } }, 'Novo aviso: '), 
                        data.ultimoAviso
                    )
                )
            );
        }

        // --- DIRECTOR NOTICES CARD (com formulário de criação) ---
        function DirectorNoticesCard() {
            const [notices, setNotices] = useState([]);
            const [loading, setLoading] = useState(true);
            const [titulo, setTitulo] = useState('');
            const [mensagem, setMensagem] = useState('');
            const [sending, setSending] = useState(false);

            const baseUrl = window.API_BASE_URL || (window.location.hostname === 'localhost' ? `http://${window.location.hostname}:3001/api` : 'https://sistema-escolar-bfty.onrender.com/api');

            async function fetchNotices() {
                try {
                    const res = await fetch(`${baseUrl}/dashboard/director-notices`, { credentials: 'include' });
                    const json = await res.json();
                    if (json.success) setNotices(json.data);
                } catch (e) {
                    console.error('Erro ao buscar avisos para diretores:', e);
                } finally {
                    setLoading(false);
                }
            }

            useEffect(() => {
                fetchNotices();
                const interval = setInterval(fetchNotices, 60000);
                return () => clearInterval(interval);
            }, []);

            async function handleSendNotice(e) {
                e.preventDefault();
                if (!titulo.trim() || !mensagem.trim() || sending) return;
                setSending(true);
                try {
                    const res = await fetch(`${baseUrl}/notificacoes`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                            tipo: 'aviso',
                            titulo: titulo.trim(),
                            mensagem: mensagem.trim(),
                            destinatarios: 'professores',
                            status: 'enviado',
                            escolaId: 'default'
                        })
                    });
                    const json = await res.json();
                    if (json.success) {
                        setTitulo('');
                        setMensagem('');
                        // Refresh the list immediately
                        fetchNotices();
                        // Update notification badge
                        updateNotifBadge(baseUrl);
                        // Show toast
                        showToast('Aviso enviado com sucesso para todos os professores!');
                    } else {
                        showToast('Erro ao enviar aviso. Tente novamente.', true);
                    }
                } catch (err) {
                    console.error('Erro ao enviar aviso:', err);
                    showToast('Erro de conexão ao enviar aviso.', true);
                } finally {
                    setSending(false);
                }
            }

            function showToast(msg, isError) {
                const existing = document.querySelector('.dnc-toast');
                if (existing) existing.remove();
                const toast = document.createElement('div');
                toast.className = 'dnc-toast';
                if (isError) {
                    toast.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
                    toast.style.color = '#fff';
                }
                toast.innerHTML = `<i class="bi ${isError ? 'bi-x-circle-fill' : 'bi-check-circle-fill'}"></i> ${msg}`;
                document.body.appendChild(toast);
                setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3200);
            }

            if (loading) {
                return h('div', { style: { color: '#94a3b8', padding: '2rem', textAlign: 'center' } }, 'Carregando mural de avisos...');
            }

            return h(motion.div, {
                className: 'director-notices-card',
                initial: { opacity: 0, y: 20 },
                animate: { opacity: 1, y: 0 },
                transition: { duration: 0.5 }
            },
                h('div', { className: 'dnc-head' },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                        h('i', { className: 'bi bi-megaphone-fill', style: { color: 'var(--a)' } }),
                        h('span', { className: 'dnc-title' }, 'MURAL DE AVISOS — TODOS OS PERFIS')
                    ),
                    h('span', { className: 'hv-live-badge' }, 
                        h('span', { className: 'hv-live-dot' }), 'AO VIVO'
                    )
                ),
                // --- FORMULÁRIO DE CRIAÇÃO ---
                h('form', { className: 'dnc-form', onSubmit: handleSendNotice },
                    h('div', { className: 'dnc-form-title' },
                        h('i', { className: 'bi bi-pencil-square' }),
                        'Enviar novo aviso para os professores'
                    ),
                    h('input', {
                        className: 'dnc-input',
                        type: 'text',
                        placeholder: 'Título do aviso...',
                        value: titulo,
                        onChange: (e) => setTitulo(e.target.value),
                        maxLength: 120,
                        required: true
                    }),
                    h('textarea', {
                        className: 'dnc-textarea',
                        placeholder: 'Escreva a mensagem do aviso...',
                        value: mensagem,
                        onChange: (e) => setMensagem(e.target.value),
                        maxLength: 1000,
                        required: true
                    }),
                    h('div', { className: 'dnc-form-actions' },
                        h('button', { 
                            className: 'dnc-btn-send', 
                            type: 'submit',
                            disabled: sending || !titulo.trim() || !mensagem.trim()
                        },
                            h('i', { className: sending ? 'bi bi-arrow-repeat' : 'bi bi-send-fill' }),
                            sending ? 'Enviando...' : 'Enviar Aviso'
                        )
                    )
                ),
                // --- LISTA DE AVISOS ---
                h('div', { className: 'dnc-body' },
                    notices.length === 0 
                        ? h('div', { style: { color: '#64748b', textAlign: 'center', padding: '2rem 1rem', fontSize: '0.85rem' } }, 'Nenhum aviso emitido até o momento.')
                        : notices.map((notice, i) => {
                            const date = new Date(notice.dataCriacao || notice.dataEnvio);
                            const formattedDate = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' às ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                            
                            let destLabel = notice.destinatarioNome || notice.destinatarios || 'Todos';
                            if (destLabel === 'todos') destLabel = 'Todos';
                            if (destLabel === 'professores') destLabel = 'Professores';
                            if (destLabel === 'diretores') destLabel = 'Diretores';

                            return h('div', { className: 'dnc-row', key: notice._id || i },
                                h('div', { className: 'dnc-row-header' },
                                    h('span', { className: 'dnc-row-title' }, notice.titulo),
                                    h('span', { className: 'dnc-row-dest' }, destLabel)
                                ),
                                h('p', { className: 'dnc-row-msg' }, notice.mensagem),
                                h('div', { className: 'dnc-row-footer' }, formattedDate)
                            );
                        })
                )
            );
        }

        // --- NOTIFICATION BADGE REAL-TIME UPDATER ---
        function updateNotifBadge(baseUrl) {
            const badge = document.getElementById('notif-badge');
            if (!badge) return;
            fetch(`${baseUrl}/notificacoes`, { credentials: 'include' })
                .then(r => r.json())
                .then(json => {
                    if (json.success && json.data) {
                        const total = json.data.length;
                        if (total > 0) {
                            badge.textContent = total > 99 ? '99+' : total;
                            badge.style.display = 'flex';
                        } else {
                            badge.style.display = 'none';
                        }
                    }
                })
                .catch(() => {});
        }

        function startNotifBadgePolling() {
            const baseUrl = window.API_BASE_URL || (window.location.hostname === 'localhost' ? `http://${window.location.hostname}:3001/api` : 'https://sistema-escolar-bfty.onrender.com/api');
            updateNotifBadge(baseUrl);
            setInterval(() => updateNotifBadge(baseUrl), 60000);
        }

        // --- ROOT ORCHESTRATOR ---
        function App() {
            const [role, setRole] = useState(null);

            useEffect(() => {
                async function fetchUser() {
                    const baseUrl = window.API_BASE_URL || (window.location.hostname === 'localhost' ? `http://${window.location.hostname}:3001/api` : 'https://sistema-escolar-bfty.onrender.com/api');
                    try {
                        const res = await fetch(`${baseUrl}/auth/me`, { credentials: 'include' });
                        const json = await res.json();
                        if (json.success && json.user) {
                            setRole(json.user.perfil);
                        }
                    } catch (e) {
                        console.error(e);
                    }
                }
                fetchUser();
                // Start notification badge polling for all roles
                startNotifBadgePolling();
            }, []);

            if (!role) return null; // loading

            if (role === 'professor') {
                return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2rem' } },
                    h(StatsPanel, null),
                    h(TeacherPanel, null)
                );
            } else {
                return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2rem' } },
                    h(StatsPanel, null),
                    h(DirectorNoticesCard, null)
                );
            }
        }

        function mount() {
            const container = document.getElementById('react-stats-panel');
            if (!container) return;
            const root = createRoot(container);
            root.render(h(App, null));
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', mount);
        } else {
            mount();
        }
    });
})();

