/**
 * Cadastro Professor Script
 * Gerencia o cadastro do perfil de professor
 */

let fotoBase64 = '';
const todasSalas = [
    '1ºA', '1ºB', '1ºC', '1ºD',
    '2ºA', '2ºB', '2ºC', '2ºD',
    '3ºA', '3ºB', '3ºC', '3ºD',
    '4ºA', '4ºB', '4ºC', '4ºD',
    '5ºA', '5ºB', '5ºC', '5ºD'
];

// === INICIALIZAÇÍO ===
document.addEventListener('DOMContentLoaded', async () => {
    await db.init();
    await auth.init();

    // Verifica autenticação
    if (!auth.isAuthenticated()) {
        window.location.href = 'index.html';
        return;
    }

    // Verifica se tem perfil de professor
    const user = auth.getCurrentUser();
    if (user.perfil !== 'professor') {
        window.location.href = 'escolher-perfil.html';
        return;
    }

    setupPhotoUpload();
    setupRoleSelection();
    setupMaterias();
    setupSalaPrincipal();
    setupForm();
});

// === UPLOAD DE FOTO ===
function setupPhotoUpload() {
    const fotoInput = document.getElementById('fotoInput');
    const photoPreview = document.getElementById('photoPreview');
    const removeFotoBtn = document.getElementById('removeFotoBtn');

    fotoInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Valida tipo
        if (!file.type.startsWith('image/')) {
            showToast('Selecione uma imagem válida', 'error');
            return;
        }

        // Valida tamanho (2MB)
        if (file.size > 2 * 1024 * 1024) {
            showToast('Imagem muito grande. Máximo 2MB', 'error');
            return;
        }

        try {
            // Redimensiona e converte para base64
            const resizedBlob = await resizeImage(file);
            const base64 = await imageToBase64(resizedBlob);

            fotoBase64 = base64;

            // Mostra preview
            photoPreview.innerHTML = `<img src="${base64}" alt="Foto">`;
            removeFotoBtn.classList.remove('hidden');

            showToast('Foto adicionada com sucesso!', 'success');
        } catch (error) {
            console.error('Erro ao processar foto:', error);
            showToast('Erro ao processar foto', 'error');
        }
    });

    removeFotoBtn.addEventListener('click', () => {
        fotoBase64 = '';
        photoPreview.innerHTML = '<i class="bi bi-person-circle"></i>';
        removeFotoBtn.classList.add('hidden');
        fotoInput.value = '';
        showToast('Foto removida', 'info');
    });
}

// === SELEÇÍO DE TIPO DE ATUAÇÍO ===
function setupRoleSelection() {
    const radios = document.querySelectorAll('input[name="tipoAtuacao"]');
    const containerPrincipal = document.getElementById('containerProfessorPrincipal');
    const containerMateria = document.getElementById('containerProfessorMateria');
    const salasAdicionaisGroup = document.getElementById('salasAdicionaisGroup');
    const salaPrincipalSelect = document.getElementById('salaPrincipal');

    radios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            const role = e.target.value;
            
            if (role === 'principal') {
                containerPrincipal.classList.remove('hidden');
                containerMateria.classList.add('hidden');
                salasAdicionaisGroup.classList.add('hidden');
                salaPrincipalSelect.required = true;
            } else {
                containerPrincipal.classList.add('hidden');
                containerMateria.classList.remove('hidden');
                salasAdicionaisGroup.classList.remove('hidden');
                salaPrincipalSelect.required = false;
                salaPrincipalSelect.value = 'VARIADOS';
                renderSalasParaProfessorEspecial();
            }
        });
    });

    const professorKeySelect = document.getElementById('professorKey');
    const nomeInput = document.getElementById('nome');
    
    if (professorKeySelect && nomeInput) {
        professorKeySelect.addEventListener('change', (e) => {
            const val = e.target.value;
            const text = e.target.options[e.target.selectedIndex].text;
            if (val && val !== 'PEB1' && val !== 'OUTRO') {
                const nomeOnly = text.split('(')[0].trim();
                nomeInput.value = nomeOnly;
                
                // Auto seleciona "Professor de Matéria" se for especialista
                const rbMateria = document.querySelector('input[name="tipoAtuacao"][value="materia"]');
                if(rbMateria) rbMateria.click();

            } else if (val === 'PEB1') {
                // Auto seleciona "Professor Principal"
                const rbPrincipal = document.querySelector('input[name="tipoAtuacao"][value="principal"]');
                if(rbPrincipal) rbPrincipal.click();
            }
        });
    }
}

// === MATÉRIAS ===
function setupMaterias() {
    // Mantém a funcionalidade original mas adaptada se necessário
}

// === SALA PRINCIPAL ===
function setupSalaPrincipal() {
    const salaPrincipalSelect = document.getElementById('salaPrincipal');

    salaPrincipalSelect.addEventListener('change', () => {
        // Para professor principal, podemos querer oferecer salas adicionais se ele for polivalente
        // mas por enquanto vamos manter simples
        renderSalasAdicionais();
    });
}

// === SALAS ADICIONAIS ===
function renderSalasAdicionais() {
    const container = document.getElementById('salasAdicionaisContainer');
    const salaPrincipal = document.getElementById('salaPrincipal').value;

    if (!salaPrincipal) {
        container.innerHTML = '<p class="text-sm text-tertiary">Selecione uma sala principal primeiro</p>';
        return;
    }

    // Filtra salas (remove a sala principal)
    const salasDisponiveis = todasSalas.filter(sala => sala !== salaPrincipal);

    container.innerHTML = '';
    salasDisponiveis.forEach(sala => {
        const item = document.createElement('span');
        item.className = 'select-multiple-item';
        item.dataset.sala = sala;
        item.innerHTML = `
            <span>${sala}</span>
            <i class="bi bi-x"></i>
        `;

        item.addEventListener('click', () => {
            const isSelected = item.classList.contains('selected');
            if (isSelected) {
                item.classList.remove('selected');
                item.style.background = 'var(--primary-light)';
                item.style.color = 'var(--primary)';
            } else {
                item.classList.add('selected');
                item.style.background = 'var(--primary)';
                item.style.color = 'white';
            }
        });

        container.appendChild(item);
    });
}

/**
 * Renderiza seleção de turmas para professores especiais (Inglês, Ed.Física, Artes)
 * Mostra TODAS as turmas disponíveis para seleção
 */
function renderSalasParaProfessorEspecial() {
    const container = document.getElementById('salasAdicionaisContainer');

    // Atualiza o texto explicativo
    const labelGroup = document.getElementById('salasAdicionaisGroup');
    const labelP = labelGroup.querySelector('p.text-sm');
    if (labelP) {
        labelP.innerHTML = '<strong>Selecione as turmas onde você dará aula:</strong>';
    }

    container.innerHTML = '';

    // Mostra TODAS as salas para seleção
    todasSalas.forEach(sala => {
        const item = document.createElement('span');
        item.className = 'select-multiple-item';
        item.dataset.sala = sala;
        item.innerHTML = `
            <span>${sala}</span>
            <i class="bi bi-check"></i>
        `;

        item.addEventListener('click', () => {
            const isSelected = item.classList.contains('selected');
            if (isSelected) {
                item.classList.remove('selected');
                item.style.background = 'var(--bg-secondary)';
                item.style.color = 'var(--text-primary)';
            } else {
                item.classList.add('selected');
                item.style.background = 'var(--primary)';
                item.style.color = 'white';
            }

            // Valida se pelo menos uma turma foi selecionada
            validarTurmasSelecionadas();
        });

        container.appendChild(item);
    });
}

/**
 * Valida se pelo menos uma turma foi selecionada para professores especiais
 */
function validarTurmasSelecionadas() {
    const turmasSelecionadas = getSalasAdicionaisSelecionadas();
    const materias = getMateriasSelecionadas();
    const temEspecial = materias.some(m => MATERIAS_ESPECIAIS.includes(m));

    if (temEspecial && turmasSelecionadas.length === 0) {
        // Mostra aviso
        const container = document.getElementById('salasAdicionaisContainer');
        let aviso = container.querySelector('.turmas-aviso');
        if (!aviso) {
            aviso = document.createElement('p');
            aviso.className = 'turmas-aviso text-sm text-danger mt-sm';
            aviso.textContent = 'Selecione pelo menos uma turma';
            container.parentNode.appendChild(aviso);
        }
    } else {
        // Remove aviso se existir
        const aviso = document.querySelector('.turmas-aviso');
        if (aviso) aviso.remove();
    }
}

function getSalasAdicionaisSelecionadas() {
    const items = document.querySelectorAll('#salasAdicionaisContainer .select-multiple-item.selected');
    return Array.from(items).map(item => item.dataset.sala);
}

// Matérias que podem ser lecionadas
const MATERIAS_ESPECIAIS = ['Inglês', 'Educação Física', 'Artes', 'SEBRAE', 'Oficina de Leitura'];

function getMateriasSelecionadas() {
    const checkboxes = document.querySelectorAll('input[name="materia"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

// === FORMULÁRIO ===
function setupForm() {
    const form = document.getElementById('cadastroProfessorForm');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Obtém o tipo de atuação selecionado
        const tipoAtuacao = document.querySelector('input[name="tipoAtuacao"]:checked').value;
        const materias = getMateriasSelecionadas();
        const salaPrincipal = document.getElementById('salaPrincipal').value;
        const turmasSelecionadas = getSalasAdicionaisSelecionadas();

        // Validações baseadas no tipo
        if (tipoAtuacao === 'principal') {
            if (!salaPrincipal) {
                showToast('Selecione sua sala principal', 'error');
                return;
            }
        } else {
            if (materias.length === 0) {
                showToast('Selecione pelo menos uma matéria', 'error');
                return;
            }
            if (turmasSelecionadas.length === 0) {
                showToast('Selecione pelo menos uma turma', 'error');
                return;
            }
        }

        // Coleta dados
        const dados = {
            idUsuario: auth.getCurrentUser()._id || auth.getCurrentUser().id,
            email: auth.getCurrentUser().email,
            tipo: 'professor',
            tipoAtuacao: tipoAtuacao, // principal ou materia
            nome: document.getElementById('nome').value.trim(),
            professorKey: document.getElementById('professorKey') ? document.getElementById('professorKey').value : '',
            foto: fotoBase64,
            escola: document.getElementById('escola').value.trim(),
            disciplina: document.getElementById('disciplina').value.trim(),
            salaPrincipal: tipoAtuacao === 'principal' ? salaPrincipal : 'VARIADOS',
            materias: tipoAtuacao === 'principal' ? ['Sala Principal'] : materias,
            salasAdicionais: turmasSelecionadas,
            biografia: document.getElementById('biografia').value.trim(),
            telefone: document.getElementById('telefone').value.trim(),
            idade: document.getElementById('idade').value,
            atividadesPessoais: document.getElementById('atividadesPessoais').value.trim(),
            ideiasParaAno: document.getElementById('ideiasParaAno').value.trim(),
            criadoEm: new Date().toISOString(),
            atualizadoEm: new Date().toISOString()
        };

        // Loading
        const submitBtn = form.querySelector('button[type="submit"]');
        showLoading(submitBtn);

        try {
            // Salva no banco
            await db.insert('professores', dados);

            showToast('Perfil de professor cadastrado com sucesso!', 'success');

            // Aguarda
            await sleep(1000);

            // Redireciona para dashboard
            window.location.href = 'dashboard.html';
        } catch (error) {
            console.error('Erro ao salvar:', error);
            showToast(error.message || 'Erro ao salvar perfil', 'error');
            hideLoading(submitBtn);
        }
    });
}

// === VOLTAR ===
function voltarPerfil() {
    if (confirm('Deseja mesmo voltar? As informações preenchidas serão perdidas.')) {
        window.location.href = 'escolher-perfil.html';
    }
}
