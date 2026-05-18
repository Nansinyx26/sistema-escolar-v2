document.addEventListener('DOMContentLoaded', async () => {
    await db.init();
    await auth.init();

    // Check Admin/Diretor permission
    const user = auth.getCurrentUser();
    if (!user || (user.perfil !== 'diretor' && user.perfil !== 'admin')) {
        alert('Acesso restrito à direção.');
        window.location.href = 'dashboard.html';
        return;
    }

    const form = document.getElementById('gradeForm');
    const selProf = document.getElementById('selectProfessor');
    const selTurma = document.getElementById('selectTurma');
    const filterProf = document.getElementById('filterProfessor');
    const tabelaBody = document.querySelector('#tabelaGrade tbody');
    const diaSelect = document.getElementById('selectDia');

    // API URL
    const API_URL = db.baseUrl;

    // Cache Global para Fallback de nomes
    let allProfessors = [];
    let allTurmas = [];

    // Mapeamento Dias
    const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

    // Mapeamento de Ícones de Matérias
    const MATERIAS_ICONS = {
        'Português': 'bi-book-fill',
        'Matemática': 'bi-calculator-fill',
        'Ciências': 'bi-flask',
        'História': 'bi-clock-history',
        'Geografia': 'bi-globe',
        'Inglês': 'bi-translate',
        'Educação Física': 'bi-trophy',
        'Artes': 'bi-palette',
        'Física': 'bi-magnet',
        'Química': 'bi-radioactive',
        'Biologia': 'bi-dna',
        'Filosofia': 'bi-lightbulb',
        'Sociologia': 'bi-people-fill',
        'Ensino Religioso': 'bi-book-half'
    };

    // Lista Padrão de Matérias (Fallback)
    const MATERIAS_PADRAO = Object.keys(MATERIAS_ICONS);

    // 1. Carregar Dados Iniciais
    const loadSelects = async () => {
        try {
            // Professores
            allProfessors = await db.getAll('professores');

            selProf.innerHTML = '<option value="">Selecione o Professor...</option>';
            filterProf.innerHTML = '<option value="">Todos os Professores</option>';

            allProfessors.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p._id; // ID do Teacher
                const emailInfo = p.email ? ` - ${p.email}` : ' (Sem email)';
                opt.textContent = `${p.nome}${emailInfo}`;
                selProf.appendChild(opt);

                const optFilter = opt.cloneNode(true);
                filterProf.appendChild(optFilter);
            });

            // Turmas
            allTurmas = await db.getAll('turmas');
            selTurma.innerHTML = '<option value="">Selecione a Turma...</option>';
            allTurmas.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t._id;
                // Fallback para nome da turma (t.nome ou t.id)
                const tNome = t.nome || t.id || 'Sem Nome';
                opt.textContent = `${tNome} (${t.periodo || ''})`;
                selTurma.appendChild(opt);
            });

        } catch (e) {
            console.error(e);
            showToast('Erro ao carregar listas.', 'error');
        }
    };

    // Renderizar Opções de Matéria
    const renderMaterias = (materiasDisponiveis) => {
        const grid = document.getElementById('materiasGrid');
        const inputHidden = document.getElementById('inputDisciplina');

        grid.innerHTML = '';
        inputHidden.value = '';

        if (!materiasDisponiveis || materiasDisponiveis.length === 0) {
            materiasDisponiveis = MATERIAS_PADRAO;
        }

        materiasDisponiveis.forEach(materia => {
            const label = document.createElement('label');
            label.className = 'checkbox-card';
            label.style.padding = '0'; // Small adjustment if needed

            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'materiaSelection';
            radio.value = materia;

            // Evento para atualizar input hidden
            radio.addEventListener('change', () => {
                inputHidden.value = radio.value;
            });

            const content = document.createElement('span');
            content.className = 'checkbox-card-content';
            content.style.padding = '1rem';

            const iconName = MATERIAS_ICONS[materia] || 'bi-journal-bookmark';

            content.innerHTML = `
                <i class="bi ${iconName}" style="font-size: 1.5rem;"></i>
                <span style="font-size: 0.9rem;">${materia}</span>
            `;

            label.appendChild(radio);
            label.appendChild(content);
            grid.appendChild(label);
        });
    };

    // Evento de Mudança de Professor
    selProf.addEventListener('change', () => {
        const profId = selProf.value;
        if (!profId) {
            document.getElementById('materiasGrid').innerHTML = '<p class="text-secondary" style="grid-column: 1/-1; padding: 1rem; text-align: center;">Selecione um professor.</p>';
            return;
        }

        const professor = allProfessors.find(p => p._id === profId || p.id === profId);

        if (professor) {
            // Se tiver matérias cadastradas, usa. Se não, usa padrão.
            const materias = (professor.materias && professor.materias.length > 0)
                ? professor.materias
                : MATERIAS_PADRAO;

            renderMaterias(materias);
        }
    });

    // 2. Carregar Lista de Grades
    const loadGrades = async () => {
        tabelaBody.innerHTML = '<tr><td colspan="6">Carregando...</td></tr>';

        try {
            const profId = filterProf.value;
            let url = `${API_URL}/grade-horaria`;
            if (profId) url += `?professorId=${profId}`;

            const resp = await fetch(url);
            const json = await resp.json();

            if (json.success) {
                renderTable(json.data);
            } else {
                tabelaBody.innerHTML = '<tr><td colspan="6">Erro ao carregar.</td></tr>';
            }
        } catch (e) {
            console.error(e);
            tabelaBody.innerHTML = `<tr><td colspan="6">Erro: ${e.message}</td></tr>`;
        }
    };

    const renderTable = (lista) => {
        tabelaBody.innerHTML = '';
        if (lista.length === 0) {
            tabelaBody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Nenhum registro encontrado.</td></tr>';
            return;
        }

        // Ordenar
        lista.sort((a, b) => {
            if (a.diaSemana !== b.diaSemana) return a.diaSemana - b.diaSemana;
            return a.horaInicio.localeCompare(b.horaInicio);
        });

        lista.forEach(item => {
            // Lógica de Fallback para exibir nomes:

            // --- Professor ---
            let nomeProf = '???';

            // 1. Tenta pegar do objeto populado (virtual ou legacy)
            if (item.professorDetails && item.professorDetails.nome) {
                nomeProf = item.professorDetails.nome;
            } else if (item.professorId && typeof item.professorId === 'object' && item.professorId.nome) {
                nomeProf = item.professorId.nome;
            } else {
                // 2. Lookup manual no array de cache (allProfessors)
                const idProcurado = String(item.professorId?._id || item.professorId?.id || item.professorId || '');

                if (idProcurado) {
                    const found = allProfessors.find(p =>
                        String(p._id) === idProcurado ||
                        String(p.id) === idProcurado ||
                        String(p.idUsuario) === idProcurado
                    );
                    if (found) nomeProf = found.nome;
                    else nomeProf = 'ID: ' + idProcurado.substring(0, 8) + '...';
                }
            }

            // --- Turma ---
            let nomeTurma = '???';
            if (item.turmaDetails && item.turmaDetails.nome) {
                nomeTurma = item.turmaDetails.nome;
            } else if (item.turmaId && typeof item.turmaId === 'object' && item.turmaId.nome) {
                nomeTurma = item.turmaId.nome;
            } else {
                const idProcurado = String(item.turmaId?._id || item.turmaId?.id || item.turmaId || '');

                if (idProcurado) {
                    const found = allTurmas.find(t =>
                        String(t._id) === idProcurado ||
                        String(t.id) === idProcurado
                    );
                    if (found) nomeTurma = found.nome || found.id || 'Sem Nome';
                    else nomeTurma = 'ID: ' + idProcurado;
                }
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${nomeProf}</td>
                <td>${nomeTurma}</td>
                <td>${item.disciplina}</td>
                <td>${DIAS[item.diaSemana]}</td>
                <td>${item.horaInicio} - ${item.horaFim}</td>
                <td>
                    <button class="btn btn-outline btn-sm" onclick="deletarGrade('${item._id}')" style="color: var(--error-color); border-color: var(--error-color);">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            `;
            tabelaBody.appendChild(tr);
        });
    };

    // 3. Adicionar Nova
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const payload = {
            professorId: selProf.value,
            turmaId: selTurma.value,
            disciplina: document.getElementById('inputDisciplina').value,
            diaSemana: parseInt(diaSelect.value),
            horaInicio: document.getElementById('horaInicio').value,
            horaFim: document.getElementById('horaFim').value,
            aulasSeguidas: parseInt(document.getElementById('aulasSeguidas').value)
        };

        try {
            if (!payload.disciplina) {
                showToast('Selecione uma disciplina', 'error');
                return;
            }

            if (payload.horaInicio >= payload.horaFim) {
                showToast('Hora fim deve ser maior que início', 'error');
                return;
            }

            const res = await fetch(`${API_URL}/grade-horaria`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await res.json();

            if (json.success) {
                showToast('Grade adicionada com sucesso!', 'success');
                form.reset();
                loadGrades();
            } else {
                showToast(json.error || 'Erro ao salvar', 'error');
            }

        } catch (error) {
            console.error(error);
            showToast(error.message || 'Erro ao salvar', 'error');
        }
    });

    // 4. Deletar (Exposed global function)
    window.deletarGrade = async (id) => {
        if (!confirm('Tem certeza que deseja remover este horário?')) return;

        try {
            await db.delete('grade-horaria', id);
            showToast('Removido com sucesso.', 'success');
            loadGrades();
        } catch (e) {
            console.error(e);
            showToast('Erro ao remover: ' + e.message, 'error');
        }
    };

    // Filtro Change
    filterProf.addEventListener('change', loadGrades);

    // Init
    await loadSelects();
    await loadGrades();
});
