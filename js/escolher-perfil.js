/**
 * Escolher Perfil Script  
 * Gerencia a escolha de perfil (Professor ou Diretor)
 */

// === INICIALIZAÇÍO ===
document.addEventListener('DOMContentLoaded', async () => {
    await db.init();
    await auth.init();

    // Verifica se está autenticado
    if (!auth.isAuthenticated()) {
        window.location.href = 'login.html';
        return;
    }

    // Se já tem perfil, redireciona
    if (auth.hasProfile()) {
        window.location.href = 'dashboard.html';
        return;
    }

    // Mostra informações do usuário
    const user = auth.getCurrentUser();
    // Log de depuração removido
});

// === SELECIONAR PERFIL ===
async function selecionarPerfil(tipoPerfil) {
    const card = document.querySelector(`.perfil-card[data-perfil="${tipoPerfil}"]`);

    if (!card) return;

    // Adiciona efeito visual
    card.classList.add('selecting');

    // Desabilita todos os botões
    const botoes = document.querySelectorAll('.perfil-card .btn');
    botoes.forEach(btn => {
        showLoading(btn);
    });

    try {
        const user = auth.getCurrentUser();

        // Define o perfil no usuário (suporta id ou _id)
        await auth.setUserProfile(user.id || user._id, tipoPerfil);

        showToast(`Perfil de ${tipoPerfil} selecionado!`, 'success');

        // Aguarda animação
        await sleep(800);

        // Redireciona para cadastro do perfil
        window.location.href = `cadastro-${tipoPerfil}.html`;
    } catch (error) {
        console.error('Erro ao selecionar perfil:', error);
        showToast(error.message || 'Erro ao selecionar perfil', 'error');

        // Remove loading dos botões
        botoes.forEach(btn => {
            hideLoading(btn);
        });

        card.classList.remove('selecting');
    }
}

// === LOGOUT ===
async function logout() {
    if (confirm('Deseja realmente sair?')) {
        await auth.logout();
    }
}
