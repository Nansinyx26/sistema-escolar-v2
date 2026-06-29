/**
 * Selecionar Turma - Page Controller
 * Gerencia a renderização e lógica da página selecionar.html usando o sistema global.
 */

const SelecionarPage = {
    async init() {
        console.log('🚀 Inicializando página de seleção de turmas...');
        try {
            // 1. Garante que o banco está pronto
            await db.init();

            // 2. Verifica autenticação
            const user = auth.getCurrentUser() || await auth.checkSession();
            if (!user) {
                console.warn('⚠️ Usuário não autenticado, redirecionando...');
                window.location.href = 'login.html';
                return;
            }

            console.log('👤 Usuário logado:', user.nome, '| Perfil:', user.perfil);

            // 3. Atualiza UI inicial
            this.updateUI(user);

            // 4. Carrega dados
            await this.renderStats(user);
            await this.renderTurmasGrid(user);

            // 5. Configura eventos
            this.setupEvents();

            console.log('✅ Página de seleção carregada com sucesso!');
        } catch (error) {
            console.error('❌ Erro fatal na inicialização:', error);
            alert('Erro ao carregar o sistema: ' + error.message);
            if (typeof showToast === 'function') showToast('Erro ao carregar dados. Tente atualizar a página.', 'error');
        }
    },

    updateUI(user) {
        // O perfil agora é centralizado na sidebar. 
        // Se precisar atualizar o nome em algum lugar específico (como boas-vindas), faça-o aqui.
        const welcomeName = document.getElementById('userName'); 
        if (welcomeName) welcomeName.textContent = user.nome;

        const cardFerramentas = document.getElementById('cardFerramentasSelecionar');
        if (cardFerramentas) {
            if (user.perfil === 'admin') {
                cardFerramentas.classList.remove('hidden');
            } else {
                cardFerramentas.classList.add('hidden');
            }
        }
    },

    async renderStats(user) {
        try {
            let [alunos, notas] = await Promise.all([
                db.getAll('alunos'),
                db.getAll('notas')
            ]);

            let turmas = await db.getAll('turmas');

            // Filtra notas órfãs (alunos deletados)
            const alunoIds = new Set(alunos.map(a => a.id || a._id));
            notas = notas.filter(n => alunoIds.has(n.alunoId || n.aluno));

            // Aplica filtros APENAS se for professor
            if (user && user.perfil === 'professor') {
                const turmasFiltradas = await this.getTurmasFiltradas(user, turmas);

                // Filtra alunos das turmas do professor
                const turmaIds = turmasFiltradas.map(t => t.id);
                alunos = alunos.filter(a => turmaIds.includes(a.turma));

                // Filtra notas das turmas do professor
                notas = notas.filter(n => turmaIds.includes(n.turma));

                // Usa turmas filtradas
                turmas = turmasFiltradas;
            }

            const els = {
                totalAlunos: document.getElementById('statTotalAlunos'),
                turmasAtivas: document.getElementById('statTurmasAtivas'),
                avaliacoes: document.getElementById('statAvaliacoes'),
                pcd: document.getElementById('statPCD')
            };

            if (els.totalAlunos) els.totalAlunos.textContent = alunos.length;
            if (els.turmasAtivas) els.turmasAtivas.textContent = turmas.length;
            if (els.avaliacoes) els.avaliacoes.textContent = notas.length;
            if (els.pcd) els.pcd.textContent = alunos.filter(a => a.deficiencia).length;
        } catch (e) {
            console.error('Erro ao renderizar estatísticas:', e);
        }
    },

    async getTurmasFiltradas(user, turmasBase) {
        // Retorna turmas filtradas para o professor
        try {
            const professores = await db.getAll('professores');

            const prof = professores.find(p => {
                const pEmail = String(p.email || '').toLowerCase();
                const uEmail = String(user.email || '').toLowerCase();
                const emailMatch = pEmail === uEmail && uEmail !== '';

                const pIdUser = String(p.idUsuario || '');
                const uId = String(user.id || user._id || '');
                const idMatch = pIdUser === uId && uId !== '';

                return emailMatch || idMatch;
            });

            if (!prof) return [];

            const permitidas = [];
            if (prof.salaPrincipal && prof.salaPrincipal !== 'VARIADOS') {
                permitidas.push(prof.salaPrincipal);
            }
            if (prof.salasAdicionais) permitidas.push(...prof.salasAdicionais);

            const normalizeTurma = (n) => String(n || '').replace('º', '').replace(/\s+/g, '').toUpperCase().trim();
            const permitidasNorm = permitidas.map(t => normalizeTurma(t));

            return turmasBase.filter(t => {
                const tIdNorm = normalizeTurma(t.id);
                return permitidasNorm.includes(tIdNorm) || permitidas.includes(t.id);
            });
        } catch (e) {
            console.error('Erro ao filtrar turmas:', e);
            return [];
        }
    },

    async renderTurmasGrid(user) {
        const container = document.getElementById('turmasGrid');
        if (!container) return;

        container.innerHTML = '<div class="loading-state"><p>Carregando turmas...</p></div>';

        try {
            let turmas = await db.getAll('turmas');
            console.log('📚 Turmas totais da config:', turmas.length);

            // Filtro de Professor
            if (user.perfil === 'professor') {
                turmas = await this.getTurmasFiltradas(user, turmas);
                console.log('✂️ Turmas após filtro:', turmas.length);

                if (turmas.length === 0) {
                    console.warn('⚠️ Cadastro de professor NÍO encontrado! Verifique se o email no cadastro de professores coincide com o email de login.');
                }
            }

            if (turmas.length === 0) {
                let msg = 'Nenhuma turma encontrada no sistema.';
                let submsg = 'Verifique o arquivo data/turmas.json';

                if (user.perfil === 'professor') {
                    msg = 'Nenhuma turma vinculada ao seu perfil.';
                    submsg = `Verifique se seu email (${user.email}) está cadastrado corretamente na lista de professores.`;
                } else if (user.perfil === 'diretor') {
                    msg = 'Nenhuma turma encontrada.';
                    submsg = 'Como diretor, você deveria ver todas as turmas. Verifique se o arquivo data/turmas.json está populado.';
                }

                container.innerHTML = `
                    <div class="empty-state">
                        <i class="bi bi-inbox"></i>
                        <h3>${msg}</h3>
                        <p>${submsg}</p>
                        ${user.perfil === 'professor' ? `<p style="font-size:0.8rem; color:var(--text-muted); margin-top:10px;">ID do Usuário: ${user.id || user._id}</p>` : ''}
                    </div>
                `;
                return;
            }

            // Agrupa por ano
            const porAno = {};
            turmas.forEach(t => {
                const ano = t.ano || 'Outros';
                if (!porAno[ano]) porAno[ano] = [];
                porAno[ano].push(t);
            });

            // Busca professores regentes para exibir nos cards
            const profsPorTurma = await this.getMapaProfessores();

            let html = '';
            Object.keys(porAno).sort().forEach(ano => {
                const turmasDoAno = porAno[ano].sort((a, b) => {
                    const idA = String(a.id || a._id || '');
                    const idB = String(b.id || b._id || '');
                    return idA.localeCompare(idB, undefined, { numeric: true });
                });

                html += `
                    <div class="ano-section">
                        <h3 class="ano-title">${ano}º Ano</h3>
                        <div class="turmas-row">
                            ${turmasDoAno.map(t => this.renderTurmaCard(t, profsPorTurma[t.id])).join('')}
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;
        } catch (error) {
            console.error('Erro ao renderizar grid:', error);
            container.innerHTML = '<p class="error">Erro ao carregar as turmas. Recarregue a página.</p>';
        }
    },

    async getMapaProfessores() {
        const mapa = {}; // { turmaId: { principal: prof, outros: [prof, prof] } }
        try {
            const professores = await db.getAll('professores');
            
            const normalize = (t) => String(t || '').replace('º', '').replace(/\s+/g, '').toUpperCase().trim();

            professores.forEach(p => {
                // Processar Sala Principal
                if (p.salaPrincipal && p.salaPrincipal !== 'VARIADOS') {
                    const tId = normalize(p.salaPrincipal);
                    if (!mapa[tId]) mapa[tId] = { principal: null, outros: [] };
                    mapa[tId].principal = p;
                }

                // Processar Salas Adicionais
                if (p.salasAdicionais && Array.isArray(p.salasAdicionais)) {
                    p.salasAdicionais.forEach(sala => {
                        const tId = normalize(sala);
                        if (!mapa[tId]) mapa[tId] = { principal: null, outros: [] };
                        
                        // Evita duplicar se for o principal
                        const isPrincipal = mapa[tId].principal && (mapa[tId].principal.id === p.id || mapa[tId].principal._id === p._id);
                        if (!isPrincipal) {
                            mapa[tId].outros.push(p);
                        }
                    });
                }
            });
        } catch (e) {
            console.error('Erro ao mapear professores:', e);
        }
        return mapa;
    },

    renderTurmaCard(turma, profs) {
        // profs é { principal: prof, outros: [] }
        const principal = profs ? profs.principal : null;
        const outros = profs ? profs.outros : [];
        
        const materias = ['Sala Principal', 'Artes', 'Inglês', 'Educação Física', 'SEBRAE', 'Oficina de Leitura'];

        // Helper para renderizar a linha do professor
        const renderProfLine = (p, label) => {
            if (!p) return '';
            const inicial = p.nome ? p.nome.charAt(0) : '?';
            return `
                <div class="professor-row" style="display:flex; align-items:center; gap:10px; margin-top:8px; padding:6px; background:rgba(255,255,255,0.03); border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
                    <div class="foto-mini" style="width:30px; height:30px; border-radius:50%; background:var(--bg-elevated); overflow:hidden; display:flex; align-items:center; justify-content:center; border:1px solid var(--border-secondary); flex-shrink:0;">
                        ${p.foto ? `<img src="${window.getPhotoUrl(p.foto)}" style="width:100%; height:100%; object-fit:cover;">` : `<span style="font-size:12px; color:var(--primary); font-weight:bold;">${inicial}</span>`}
                    </div>
                    <div style="display:flex; flex-direction:column; align-items:flex-start;">
                        <span style="font-size:0.85rem; font-weight:600; color:var(--text-primary); line-height:1.2;">${p.nome}</span>
                        <span style="font-size:0.65rem; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.05em;">${label}</span>
                    </div>
                </div>
            `;
        };

        return `
            <div class="turma-card" id="card-${turma.id}" data-turma="${turma.id}">
                <div class="turma-card-content" data-turma="${turma.id}" style="width:100%;">
                    <div class="turma-card-header" style="display:flex; justify-content:space-between; align-items:flex-start; width:100%;">
                        <div class="turma-icon">${turma.ano}${turma.sala}</div>
                        <div class="expand-icon" style="color:var(--primary); font-size:1.5rem; transition:transform 0.3s; z-index:2;">
                            <i class="bi bi-chevron-down"></i>
                        </div>
                    </div>
                    <div class="turma-info">
                        <h4>Turma ${turma.id}</h4>
                        <p style="color:var(--text-secondary); font-size:0.85rem; margin-bottom:12px;">Turno: ${turma.turno || turma.periodo || 'Manhã'}</p>
                        
                        <div class="professores-container" style="width:100%;">
                            ${renderProfLine(principal, 'Sala Principal')}
                            ${outros.map(p => renderProfLine(p, 'Professor Auxiliar/Materia')).join('')}
                            ${(!principal && outros.length === 0) ? `<p style="font-size:0.8rem; color:var(--text-tertiary); margin-top:10px;">Sem professor atribuído</p>` : ''}
                        </div>
                    </div>
                </div>
                <div class="turma-expand-tabs" id="tabs-${turma.id}">
                    ${materias.map(m => `
                        <button class="turma-tab-btn ${m === 'Sala Principal' ? 'sala-principal' : ''}" 
                                data-turma="${turma.id}" data-materia="${m}">
                            <i class="bi ${this.getIcon(m)}"></i> ${m}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    },

    getIcon(m) {
        const icons = {
            'Sala Principal': 'bi-people-fill',
            'Artes': 'bi-palette-fill',
            'Inglês': 'bi-translate',
            'Educação Física': 'bi-bicycle',
            'SEBRAE': 'bi-lightbulb-fill',
            'Oficina de Leitura': 'bi-book-half'
        };
        return icons[m] || 'bi-book';
    },

    toggleCard(id) {
        document.querySelectorAll('.turma-card').forEach(c => {
            if (c.id !== `card-${id}`) c.classList.remove('expanded');
        });
        document.getElementById(`card-${id}`)?.classList.toggle('expanded');
    },

    abrirTurma(id, materia) {
        const b = 1; // Default bimestre
        window.location.href = `turma.html?turma=${id}&bim=${b}&materia=${encodeURIComponent(materia)}`;
    },

    setupEvents() {
        document.getElementById('btnLogout')?.addEventListener('click', () => {
            sessionStorage.clear();
            window.location.href = 'login.html';
        });
        document.getElementById('btnDashboard')?.addEventListener('click', () => {
            if (typeof window.smartBack === 'function') window.smartBack('dashboard.html');
            else window.location.href = 'dashboard.html';
        });

        // Event Delegation para o grid de turmas (respeita CSP script-src-attr 'none')
        const grid = document.getElementById('turmasGrid');
        if (grid) {
            grid.addEventListener('click', (e) => {
                // 1. Clique no botão da matéria
                const tabBtn = e.target.closest('.turma-tab-btn');
                if (tabBtn) {
                    e.stopPropagation();
                    e.preventDefault();
                    const turmaId = tabBtn.dataset.turma;
                    const materia = tabBtn.dataset.materia;
                    if (turmaId && materia) {
                        this.abrirTurma(turmaId, materia);
                    }
                    return;
                }

                // 2. Clique no card para expandir
                const turmaCard = e.target.closest('.turma-card');
                if (turmaCard) {
                    const turmaId = turmaCard.dataset.turma;
                    if (turmaId) {
                        this.toggleCard(turmaId);
                    }
                }
            });
        }
    }
};

// Torna global para acesso via onclick no HTML
window.SelecionarPage = SelecionarPage;

// Inicia ao carregar o DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => SelecionarPage.init());
} else {
    SelecionarPage.init();
}
