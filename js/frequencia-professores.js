document.addEventListener('DOMContentLoaded', async () => {
    // Inicializar Auth e DB
    await db.init();
    await auth.init();

    // Check Auth
    if (!auth.isAuthenticated()) {
        window.location.href = 'index.html';
        return;
    }

    const user = auth.getCurrentUser();
    const API_URL = db.baseUrl;

    // Fill Date
    document.getElementById('dataLancamento').valueAsDate = new Date();

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

    // Renderizar Opções de Matéria
    const renderMaterias = (materiasDisponiveis) => {
        const grid = document.getElementById('materiasGrid');
        const inputHidden = document.getElementById('materia');

        grid.innerHTML = '';
        inputHidden.value = '';

        if (!materiasDisponiveis || materiasDisponiveis.length === 0) {
            grid.innerHTML = '<p class="text-secondary">Nenhuma matéria cadastrada.</p>';
            return;
        }

        materiasDisponiveis.forEach(materia => {
            const label = document.createElement('label');
            label.className = 'checkbox-card';
            label.style.padding = '0';

            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'materiaSelection';
            radio.value = materia;

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

    // Fill User Data
    const nomeInput = document.getElementById('nomeProfessor');
    const escolaInput = document.getElementById('nomeEscola');
    const classeSelect = document.getElementById('classe');

    let professorData = user;

    try {
        if (user.perfil === 'professor') {
            // Busca dados completos na collection 'professores'
            const professores = await db.getAll('professores');
            // Tenta achar por ID de usuário ou Email
            let prof = professores.find(p => p.idUsuario === user._id || (p.email && p.email === user.email));

            // Fallback: Tenta achar pelo NOME (caso o diretor tenha cadastrado apenas com nome)
            if (!prof && user.nome) {
                console.log('Tentando buscar perfil pelo nome:', user.nome);
                prof = professores.find(p => p.nome && p.nome.trim().toLowerCase() === user.nome.trim().toLowerCase());
            }

            if (prof) {
                professorData = { ...user, ...prof };
            } else {
                console.warn('Perfil de professor não encontrado para este usuário. A grade pode não aparecer.');
                // Opcional: Mostrar aviso visual discreto ou manter silêncio para não bloquear.
            }
        } else if (user.perfil === 'diretor') {
            const diretores = await db.getAll('diretores');
            const dir = diretores.find(d => d.idUsuario === user._id);
            if (dir) {
                professorData = { ...user, ...dir };
            }
        }
    } catch (e) {
        console.error('Erro ao buscar perfil detalhado:', e);
    }

    nomeInput.value = professorData.nome || '';
    escolaInput.value = professorData.escola || '';
    nomeInput.value = professorData.nome || '';
    escolaInput.value = professorData.escola || '';

    // Configura matérias - Agora exibe TODAS as opções para permitir flexibilidade
    const todasMaterias = Object.keys(MATERIAS_ICONS);
    renderMaterias(todasMaterias);

    // Handle Submission
    const form = document.getElementById('attendanceForm');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const data = {
            data: document.getElementById('dataLancamento').value,
            nomeProfessor: nomeInput.value,
            professorId: professorData._id || user._id,
            escola: escolaInput.value || 'Escola Padrão',
            disciplina: document.getElementById('materia').value || 'Multidisciplinar',
            classe: classeSelect.value,
            quantidadeAulas: document.getElementById('quantidadeAulas').value,
            observacao: document.getElementById('observacao').value,
            usuarioId: user._id
        };

        // Log de depuração removido

        if (!data.escola || !data.disciplina) {
            console.error('Campos faltantes:', { escola: data.escola, disciplina: data.disciplina });
            showToast(`Erro: Campos obrigatórios faltando. Escola: ${data.escola || 'Vazio'}, Matéria: ${data.disciplina || 'Vazio'}`, 'error');
            // setTimeout(() => window.location.href = 'perfil.html', 2000); // Comentado para não redirecionar em teste
            return;
        }

        try {
            const btn = form.querySelector('button[type="submit"]');
            const originalContent = btn.innerHTML;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Salvando...';
            btn.disabled = true;

            // Salvar usando a API via db.js
            // O StoreName deve bater com o endpoint da API (/api/frequencia-professores)

            await db.insert('frequencia-professores', {
                ...data,
                criadoEm: new Date().toISOString()
            });

            showToast('Lançamento salvo com sucesso!', 'success');

            // Reset parcial
            form.reset();
            document.getElementById('dataLancamento').valueAsDate = new Date();
            nomeInput.value = professorData.nome || '';
            escolaInput.value = professorData.escola || '';
            renderMaterias((professorData.materias && professorData.materias.length > 0)
                ? professorData.materias
                : (professorData.disciplina ? [professorData.disciplina] : []));

            btn.innerHTML = originalContent;
            btn.disabled = false;

        } catch (error) {
            console.error(error);
            const btn = form.querySelector('button[type="submit"]');
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-save"></i> Salvar Lançamento';

            // Tratamento especial para erro de chamada pendente (Bloqueio)
            if (error.message.includes('A frequência dos alunos') || (error.code === 'CHAMADA_PENDENTE')) {
                showModalAlert('Atenção Professor', error.message, 'warning');
            } else {
                showToast(error.message || 'Erro ao salvar', 'error');
            }
        }
    });

    // Check if profile fields are missing
    if ((!professorData.escola || (!professorData.disciplina && !professorData.materias)) && user.perfil === 'professor') {
        const confirmEdit = confirm('Seu perfil não possui Escola ou Disciplina cadastrados. Deseja atualizar agora?');
        if (confirmEdit) {
            window.location.href = 'perfil.html';
        }
    }

    // --- SEMÁFORO: Validação em Tempo Real ---

    const submitBtn = form.querySelector('button[type="submit"]');
    const statusContainer = document.createElement('div');
    statusContainer.style.marginTop = '1rem';
    statusContainer.style.fontWeight = 'bold';
    submitBtn.parentNode.insertBefore(statusContainer, submitBtn);

    const checkPermission = async () => {
        const dataVal = document.getElementById('dataLancamento').value;
        const nomeProf = nomeInput.value;
        const turmaVal = classeSelect.value;

        console.log('--- Check Permission ---');
        // Log de depuração removido
        console.log('Turma:', turmaVal);
        console.log('Nome:', nomeProf);

        // Limpa estado anterior se faltar dados
        if (!dataVal || !turmaVal || !nomeProf) {
            console.log('Faltam dados para validar.');
            statusContainer.innerHTML = '';
            submitBtn.disabled = false;
            return;
        }

        // Correção Validar "Hoje" (Local Time)
        // new Date() é data atual com hora.
        // dataVal é string YYYY-MM-DD.
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hojeLocal = `${year}-${month}-${day}`;

        console.log('Hoje (Local):', hojeLocal, 'Input:', dataVal);

        if (dataVal === hojeLocal) {
            console.log('Validando no Backend...');
            try {
                // Precisamos identificar o professor ID correto (Perfil)
                const teacherId = professorData._id || user._id;

                // --- DEBUG ADICIONAL ---
                if (!teacherId) console.error('ERRO CRÍTICO: TeacherID indefinido', professorData);

                const url = `${API_URL}/grade-horaria/validar?professorId=${teacherId}&turmaId=${turmaVal}`;
                console.log('Fetching:', url);

                const resp = await fetch(url);
                const json = await resp.json();
                console.log('Resp:', json);

                if (json.permitido) {
                    const isExato = json.tipo === 'horario_exato';

                    statusContainer.innerHTML = isExato
                        ? `<span style="color: var(--success-color);"><i class="bi bi-check-circle"></i> Grade Confirmada: Aula em andamento (${json.detalhes.horaInicio} - ${json.detalhes.horaFim}).</span>`
                        : `<span style="color: var(--warning-color);"><i class="bi bi-calendar-check"></i> Grade Confirmada: Aula deste dia identificada (${json.detalhes.horaInicio} - ${json.detalhes.horaFim}). Lançamento liberado.</span>`;

                    submitBtn.disabled = false;
                    submitBtn.title = isExato ? "Horário permitido" : "Lançamento retroativo para hoje liberado";

                    // Auto-selecionar Matéria baseada na Grade (Apenas se vazio)
                    if (json.detalhes.disciplina) {
                        const disciplinaGrade = json.detalhes.disciplina;
                        const matInput = document.getElementById('materia');

                        // Só auto-seleciona se o usuário ainda não escolheu nada
                        if (matInput && !matInput.value) {
                            matInput.value = disciplinaGrade;

                            // Tenta marcar visualmente o checkbox correspondente
                            const checkboxes = document.querySelectorAll('#materiasGrid input[type="radio"], #materiasGrid input[type="checkbox"]');
                            checkboxes.forEach(cb => {
                                if (cb.value === disciplinaGrade) {
                                    cb.checked = true;
                                    cb.dispatchEvent(new Event('change'));
                                }
                            });
                        }
                    }

                    // Visual Feedback
                    classeSelect.classList.add('is-valid');
                    document.getElementById('dataLancamento').classList.add('is-valid');
                    if (nomeInput.value) nomeInput.classList.add('is-valid');
                    if (escolaInput.value) escolaInput.classList.add('is-valid');

                    // Validation for Aulas
                    const qtdInput = document.getElementById('quantidadeAulas');
                    const maxAulas = json.detalhes.aulasSeguidas || 1;

                    // Configura o input com o limite real
                    qtdInput.max = maxAulas;
                    qtdInput.placeholder = `Máx: ${maxAulas}`;
                    qtdInput.title = `Limite de aulas permitidas neste horário: ${maxAulas}`;

                    // Valida valor inicial
                    if (qtdInput.value > 0 && qtdInput.value <= maxAulas) {
                        qtdInput.classList.add('is-valid');
                    } else {
                        qtdInput.classList.remove('is-valid');
                    }

                    qtdInput.oninput = () => {
                        if (qtdInput.value > 0 && qtdInput.value <= maxAulas) {
                            qtdInput.classList.add('is-valid');
                        } else {
                            qtdInput.classList.remove('is-valid');
                        }
                    };

                } else {
                    statusContainer.innerHTML = '<span style="color: var(--error-color);"><i class="bi bi-clock-history"></i> Fora do horário de grade. Botão bloqueado.</span>';
                    submitBtn.disabled = true;
                    submitBtn.title = "Você não possui aula registrada para este horário na grade.";

                    // Remover Feedback
                    classeSelect.classList.remove('is-valid');
                    // Não removemos do dataLancamento se estiver ok, mas semanticamente o conjunto (data+turma) falhou.
                    // Vamos remover de ambos para sinalizar que o par está errado.
                    document.getElementById('dataLancamento').classList.remove('is-valid');
                }

            } catch (e) {
                console.error('Erro validação grade', e);
                statusContainer.innerHTML = '<span style="color: var(--warning-color);">Erro de conexão ao validar.</span>';
            }
        } else {
            // Retroativo
            console.log('Data retroativa/futura. Validação ignorada.');
            statusContainer.innerHTML = '<span style="color: var(--warning-color);"><i class="bi bi-calendar-check"></i> Modo Retroativo: A validação será feita ao salvar.</span>';
            submitBtn.disabled = false;
            submitBtn.title = "";
        }
    };

    classeSelect.addEventListener('change', checkPermission);
    document.getElementById('dataLancamento').addEventListener('change', checkPermission);
    // Adicionar listener caso o nome demore a carregar
    // setTimeout(checkPermission, 1000); 
    // Melhor: chamar checkPermission após carregar user data lá em cima, mas o setTimeout aqui serve de fallback.
    setTimeout(checkPermission, 1500);

    // --- MODAL: Minha Grade ---
    const modal = document.getElementById('modalGrade');
    const btnGrade = document.getElementById('btnMinhaGrade');
    const closeGrade = document.getElementById('closeModalGrade');
    const conteudoGrade = document.getElementById('conteudoGrade');

    if (modal && btnGrade) {
        // Fix CSS inline bug via JS because I can't edit HTML again just for that now
        modal.style.background = 'rgba(0,0,0,0.8)';

        btnGrade.addEventListener('click', async () => {
            modal.style.display = 'flex';
            conteudoGrade.innerHTML = '<p>Carregando...</p>';

            try {
                // Fetch grade USANDO O ID DO PROFESSOR (perfil), não do Usuário
                // professorData._id deve conter o ID da collection 'professores'/'Teacher'
                const teacherId = professorData._id || user._id;
                console.log('Buscando grade. User ID:', user._id, 'Teacher ID usado:', teacherId, 'Has Profile:', !!professorData._id);

                const resp = await fetch(`${API_URL}/grade-horaria?professorId=${teacherId}`);
                const json = await resp.json();

                if (json.success && json.data && json.data.length > 0) {
                    const dias = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

                    const lista = json.data.sort((a, b) => {
                        if (a.diaSemana !== b.diaSemana) return a.diaSemana - b.diaSemana;
                        return a.horaInicio.localeCompare(b.horaInicio);
                    });

                    let html = `
                        <table style="width: 100%; border-collapse: collapse; color: var(--text-primary);">
                            <thead>
                                <tr style="border-bottom: 1px solid var(--border-color); text-align: left;">
                                    <th style="padding: 0.5rem;">Dia</th>
                                    <th style="padding: 0.5rem;">Horário</th>
                                    <th style="padding: 0.5rem;">Turma</th>
                                    <th style="padding: 0.5rem;">Disciplina</th>
                                </tr>
                            </thead>
                            <tbody>
                    `;

                    lista.forEach(g => {
                        html += `
                            <tr style="border-bottom: 1px solid var(--border-color);">
                                <td style="padding: 0.5rem;">${dias[g.diaSemana] || g.diaSemana}</td>
                                <td style="padding: 0.5rem;">${g.horaInicio} - ${g.horaFim}</td>
                                <td style="padding: 0.5rem;">${(g.turmaDetails && g.turmaDetails.nome) ? g.turmaDetails.nome : ((g.turmaId && g.turmaId.nome) ? g.turmaId.nome : '???')}</td>
                                <td style="padding: 0.5rem;">${g.disciplina}</td>
                            </tr>
                        `;
                    });

                    html += '</tbody></table>';
                    conteudoGrade.innerHTML = html;

                } else {
                    conteudoGrade.innerHTML = '<p>Nenhuma grade cadastrada.</p>';
                }

            } catch (e) {
                console.error(e);
                conteudoGrade.innerHTML = '<p style="color: var(--error-color)">Erro ao carregar grade.</p>';
            }
        });

        closeGrade.addEventListener('click', () => {
            modal.style.display = 'none';
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });
    }

});
