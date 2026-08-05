/**
 * Cadastro Diretor Script
 * Gerencia o cadastro do perfil de diretor
 */

let fotoBase64 = '';

// === INICIALIZAÇÍO ===
document.addEventListener('DOMContentLoaded', async () => {
    await db.init();
    await auth.init();

    // Verifica autenticação
    if (!auth.isAuthenticated()) {
        window.location.href = 'login.html';
        return;
    }

    // Verifica se tem perfil de diretor
    const user = auth.getCurrentUser();
    if (user.perfil !== 'diretor') {
        window.location.href = 'escolher-perfil.html';
        return;
    }

    setupPhotoUpload();
    setupForm();
    setupBackButton();
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

// === FORMULÁRIO ===
function setupForm() {
    const form = document.getElementById('cadastroDiretorForm');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Coleta dados
        const dados = {
            idUsuario: auth.getCurrentUser()._id,
            tipo: 'diretor',
            nome: document.getElementById('nome').value.trim(),
            foto: fotoBase64,
            escola: document.getElementById('escola').value.trim(),
            biografia: document.getElementById('biografia').value.trim(),
            telefone: document.getElementById('telefone').value.trim(),
            idade: document.getElementById('idade').value,
            permissoes: [
                'alterar_salas',
                'ver_graficos',
                'ver_notas',
                'gerenciar_professores',
                'relatorios'
            ],
            criadoEm: new Date().toISOString(),
            atualizadoEm: new Date().toISOString()
        };

        // Loading
        const submitBtn = form.querySelector('button[type="submit"]');
        showLoading(submitBtn);

        try {
            // Salva no banco
            await db.insert('diretores', dados);

            showToast('Perfil de diretor cadastrado com sucesso!', 'success');

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
function setupBackButton() {
    const btnVoltar = document.getElementById('btn-voltar-diretor');
    if (btnVoltar) {
        btnVoltar.addEventListener('click', voltarPerfil);
    }
}

function voltarPerfil() {
    if (confirm('Deseja mesmo voltar? As informações preenchidas serão perdidas.')) {
        window.location.href = 'escolher-perfil.html';
    }
}
