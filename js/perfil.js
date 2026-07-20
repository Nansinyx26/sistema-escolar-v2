/**
 * Perfil Page Script - Edição de Perfil
 * Permite editar foto e dados pessoais
 */

let fotoBase64 = '';
let perfilAtual = null;
let tipoPerfilAtual = null;

// === INICIALIZAÇÍO ===
document.addEventListener('DOMContentLoaded', async () => {
    await db.init();
    await auth.init();

    // Verifica autenticação
    if (!auth.isAuthenticated()) {
        window.location.href = 'login.html';
        return;
    }

    // Verifica se tem perfil
    if (!auth.hasProfile()) {
        window.location.href = 'escolher-perfil.html';
        return;
    }

    await carregarPerfil();
    setupPhotoUpload();
    setupForm();
    setupInputMasks();
    setupAvaliacao();

    // Mostra botão Ferramentas apenas para admin
    const user = auth.getCurrentUser();
    if (user.perfil === 'admin') {
        const btnFerramentas = document.getElementById('btnFerramentas');
        if (btnFerramentas) {
            btnFerramentas.classList.remove('hidden');
        }
    }
});

// === CARREGAR PERFIL ===
async function carregarPerfil() {
    try {
        const user = auth.getCurrentUser();
        if (!user) {
            console.error('❌ Usuário não encontrado na sessão');
            showToast('Sessão expirada', 'error');
            return;
        }

        console.log('👤 Carregando perfil para:', user.email);
        tipoPerfilAtual = user.perfil;

        // Admin usa o próprio usuário
        if (user.perfil === 'admin') {
            try {
                // Tenta buscar dados atualizados do usuário
                const adminUser = await db.getById('usuarios', user._id || user.id);
                perfilAtual = adminUser || user;

                // Garante campos mínimos se não existirem
                if (!perfilAtual.biografia) perfilAtual.biografia = 'Administrador do sistema.';
                if (!perfilAtual.nome) perfilAtual.nome = user.nome || 'Administrador';

            } catch (e) {
                console.error('Erro ao buscar admin:', e);
                perfilAtual = user;
            }
        } else {
            // Professor ou Diretor
            const collection = user.perfil === 'professor' ? 'professores' : 'diretores';
            console.log(`🔍 Buscando em '${collection}'...`);

            const todos = await db.getAll(collection);
            console.log(`📊 Total de ${collection} carregados:`, todos.length);

            // Tenta encontrar por diversos campos de vínculo
            perfilAtual = todos.find(p => {
                const userId = String(user.id || user._id);
                return String(p.idUsuario) === userId ||
                    String(p.userId) === userId ||
                    String(p.usuarioId) === userId ||
                    (p.email && String(p.email).toLowerCase() === String(user.email).toLowerCase());
            });

            if (!perfilAtual) {
                console.warn(`⚠️ Perfil ausente em '${collection}'. Gerando perfil básico...`);
                // Gera perfil básico para evitar que o usuário fique travado
                perfilAtual = {
                    idUsuario: user._id || user.id,
                    nome: user.nome || 'Usuário',
                    email: user.email,
                    ativo: true,
                    isNew: true // Marcador para usarmos db.add depois
                };
                showToast('Configurando seu perfil pela primeira vez...', 'info');
            } else {
                console.log('✅ Perfil encontrado:', perfilAtual.nome);
            }
        }

        // Preenche formulário
        preencherFormulario(user, perfilAtual);

    } catch (error) {
        console.error('Erro ao carregar perfil:', error);
        showToast('Erro ao carregar perfil', 'error');
    }
}

// === PREENCHER FORMULÁRIO ===
function preencherFormulario(user, perfil) {
    // Foto
    const photoPreview = document.getElementById('photoPreview');
    const removeFotoBtn = document.getElementById('removeFotoBtn');
    const fotoUrl = window.getPhotoUrl(perfil.foto, user.fotoGoogle);
    
    if (photoPreview) {
        photoPreview.innerHTML = `<img src="${fotoUrl}" alt="Foto" class="user-avatar avatar-xxl">`;
        if (perfil.foto || (user.fotoGoogle && fotoUrl === user.fotoGoogle)) {
             removeFotoBtn.classList.remove('hidden');
        }
    }

    // Informações básicas
    document.getElementById('nome').value = perfil.nome || '';
    document.getElementById('cpf').value = perfil.cpf || user.cpf || '';
    document.getElementById('telefone').value = perfil.telefone || user.telefone || '';
    document.getElementById('idade').value = perfil.idade || '';
    document.getElementById('biografia').value = perfil.biografia || '';

    // Informações da conta
    document.getElementById('email').value = user.email;

    // Tipo de perfil
    let tipoPerfil = 'Usuário';
    if (user.perfil === 'admin') {
        tipoPerfil = 'Administrador';
    } else if (user.perfil === 'professor') {
        tipoPerfil = 'Professor';
    } else if (user.perfil === 'diretor') {
        tipoPerfil = 'Diretor';
    }
    document.getElementById('tipoPerfil').value = tipoPerfil;

    // Informações específicas de professor
    const escolaInput = document.getElementById('escola');
    const disciplinaInput = document.getElementById('disciplina');

    if (user.perfil === 'professor') {
        document.getElementById('infoProfessor').classList.remove('hidden');
        if (escolaInput) escolaInput.required = true;
        if (disciplinaInput) disciplinaInput.required = true;

        document.getElementById('salaPrincipal').value = perfil.salaPrincipal || '';

        // Matérias
        const materiasDisplay = document.getElementById('materiasDisplay');
        materiasDisplay.innerHTML = '';
        if (perfil.materias && perfil.materias.length > 0) {
            perfil.materias.forEach(materia => {
                const badge = document.createElement('span');
                badge.className = 'badge badge-primary';
                badge.textContent = materia;
                materiasDisplay.appendChild(badge);
            });
        }

        // Salas adicionais
        if (perfil.salasAdicionais && perfil.salasAdicionais.length > 0) {
            document.getElementById('salasAdicionaisDisplay').classList.remove('hidden');
            const salasDisplay = document.getElementById('salasDisplay');
            salasDisplay.innerHTML = '';
            perfil.salasAdicionais.forEach(sala => {
                const badge = document.createElement('span');
                badge.className = 'badge badge-secondary';
                badge.textContent = sala;
                salasDisplay.appendChild(badge);
            });
        }

        document.getElementById('ideiasParaAno').value = perfil.ideiasParaAno || '';
        document.getElementById('escola').value = perfil.escola || '';
        document.getElementById('disciplina').value = perfil.disciplina || '';
    } else {
        // Se não for professor, garante que campos obrigatórios ocultos não bloqueiem o form
        if (escolaInput) escolaInput.required = false;
        if (disciplinaInput) disciplinaInput.required = false;
    }

    // Seção "Minha Escola" — trocar de escola (professor/diretor/secretaria)
    initTrocarEscola(user);
}

// === TROCAR DE ESCOLA (professor / diretor / secretaria) ===
function apiBaseUrl() {
    return window.API_BASE_URL || (window.location.hostname === 'localhost'
        ? `http://${window.location.hostname}:3001/api`
        : 'https://sistema-escolar-bfty.onrender.com/api');
}

function initTrocarEscola(user) {
    const secao = document.getElementById('secaoTrocarEscola');
    if (!secao) return;

    const cargosComEscola = ['professor', 'diretor', 'secretaria'];
    if (!cargosComEscola.includes(user.perfil)) {
        secao.classList.add('hidden');
        return;
    }
    secao.classList.remove('hidden');

    // Carrega a escola ativa atual
    const nomeEl = document.getElementById('escolaAtivaPerfil');
    fetch(`${apiBaseUrl()}/escolas/minhas`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(json => {
            if (json && json.success && Array.isArray(json.data) && json.data.length) {
                const ativa = json.data.find(e => String(e._id) === String(json.escolaAtivaId)) || json.data[0];
                if (nomeEl) nomeEl.value = ativa ? ativa.nome : 'Não definida';
            } else if (nomeEl) {
                nomeEl.value = perfilAtual?.escola || 'Não definida';
            }
        })
        .catch(() => { if (nomeEl) nomeEl.value = perfilAtual?.escola || 'Não definida'; });

    const btn = document.getElementById('btnMudarEscola');
    if (btn && !btn.dataset.bound) {
        btn.dataset.bound = '1';
        btn.addEventListener('click', mudarEscola);
    }
}

async function mudarEscola() {
    const input = document.getElementById('novoCodigoEscola');
    const btn = document.getElementById('btnMudarEscola');
    const codigo = (input?.value || '').trim();
    if (!codigo) {
        showToast('Digite o código secreto da nova escola.', 'warning');
        return;
    }
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    try {
        const res = await fetch(`${apiBaseUrl()}/escolas/mudar`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': document.cookie.match(/csrf_token=([^;]+)/)?.[1] || ''
            },
            body: JSON.stringify({ codigoEscola: codigo })
        });
        const json = await res.json();
        if (res.ok && json.success) {
            showToast(json.message || 'Escola atualizada!', 'success');
            const nomeEl = document.getElementById('escolaAtivaPerfil');
            if (nomeEl && json.escolaNome) nomeEl.value = json.escolaNome;
            if (input) input.value = '';
            setTimeout(() => { window.location.href = json.redirect_to || 'dashboard.html'; }, 900);
        } else {
            showToast(json.error || 'Não foi possível trocar de escola.', 'error');
        }
    } catch (e) {
        showToast('Falha de conexão ao trocar de escola.', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    }
}

// === UPLOAD DE FOTO ===
function setupPhotoUpload() {
    const fotoInput = document.getElementById('fotoInput');
    const photoPreview = document.getElementById('photoPreview');
    const removeFotoBtn = document.getElementById('removeFotoBtn');
    const googleFotoNotice = document.getElementById('googleFotoNotice');

    fotoInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Valida tipo
        if (!file.type.startsWith('image/')) {
            showToast('Selecione uma imagem válida', 'error');
            return;
        }

        // Valida tamanho (3MB)
        if (file.size > 3 * 1024 * 1024) {
            showToast('Imagem muito grande. Máximo 3MB', 'error');
            return;
        }

        try {
            // Ler arquivo como base64
            const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (ev) => resolve(ev.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            // Crop quadrado via canvas
            const croppedBase64 = await cropSquare(base64);

            // Preview imediato
            photoPreview.innerHTML = `<img src="${croppedBase64}" alt="Preview" class="user-avatar avatar-xxl">`;

            // Mostrar loading
            const uploadLabel = document.querySelector('label[for="fotoInput"]');
            const originalLabel = uploadLabel ? uploadLabel.innerHTML : '';
            if (uploadLabel) {
                uploadLabel.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Enviando...';
                uploadLabel.style.pointerEvents = 'none';
            }

            // Enviar diretamente ao backend
            const baseUrl = window.API_BASE_URL || (window.location.hostname === 'localhost' ? `http://${window.location.hostname}:3001/api` : 'https://sistema-escolar-bfty.onrender.com/api');
            const res = await fetch(`${baseUrl}/usuarios/foto`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': document.cookie.match(/csrf_token=([^;]+)/)?.[1] || ''
                },
                body: JSON.stringify({ foto: croppedBase64 }),
                credentials: 'include'
            });

            const data = await res.json();

            if (uploadLabel) {
                uploadLabel.innerHTML = originalLabel;
                uploadLabel.style.pointerEvents = '';
            }

            if (data.success) {
                showToast('Foto atualizada com sucesso!', 'success');
                removeFotoBtn.classList.remove('hidden');
                fotoBase64 = croppedBase64;

                // Atualizar avatar globalmente sem reload
                const user = auth.getCurrentUser();
                if (user) {
                    user.foto = data.user.foto;
                    auth.updateSession(user);
                    if (window.updateAllAvatars) window.updateAllAvatars(user);
                }

                // Mostrar notice se tem foto do Google
                if (googleFotoNotice && user && user.loginGoogle) {
                    googleFotoNotice.classList.remove('hidden');
                }
            } else {
                showToast(data.error || 'Erro ao enviar foto', 'error');
                // Reverter preview
                const fotoUrl = window.getPhotoUrl ? window.getPhotoUrl(perfilAtual?.foto, auth.getCurrentUser()?.fotoGoogle) : '';
                if (fotoUrl) {
                    photoPreview.innerHTML = `<img src="${fotoUrl}" alt="Foto" class="user-avatar avatar-xxl">`;
                } else {
                    photoPreview.innerHTML = '<i class="bi bi-person-circle"></i>';
                }
            }
        } catch (error) {
            console.error('Erro ao processar foto:', error);
            showToast('Erro ao processar foto: ' + error.message, 'error');
        }

        fotoInput.value = '';
    });

    // Remover foto manual via DELETE endpoint
    removeFotoBtn.addEventListener('click', async () => {
        if (!confirm('Deseja remover sua foto de perfil?')) return;

        try {
            removeFotoBtn.disabled = true;
            const baseUrl = window.API_BASE_URL || (window.location.hostname === 'localhost' ? `http://${window.location.hostname}:3001/api` : 'https://sistema-escolar-bfty.onrender.com/api');
            const res = await fetch(`${baseUrl}/usuarios/foto`, {
                method: 'DELETE',
                headers: { 
                    'X-CSRF-Token': document.cookie.match(/csrf_token=([^;]+)/)?.[1] || ''
                },
                credentials: 'include'
            });

            const data = await res.json();
            removeFotoBtn.disabled = false;

            if (data.success) {
                fotoBase64 = '';
                window.pendingPhotoFile = null;

                // Verificar se tem fotoGoogle para usar como fallback
                const user = auth.getCurrentUser();
                if (user) {
                    user.foto = '';
                    auth.updateSession(user);
                    if (window.updateAllAvatars) window.updateAllAvatars(user);
                }

                const fotoGoogle = user?.fotoGoogle;
                if (fotoGoogle) {
                    photoPreview.innerHTML = `<img src="${fotoGoogle}" alt="Foto Google" class="user-avatar avatar-xxl">`;
                } else {
                    photoPreview.innerHTML = '<i class="bi bi-person-circle"></i>';
                }
                removeFotoBtn.classList.add('hidden');
                if (googleFotoNotice) googleFotoNotice.classList.add('hidden');
                fotoInput.value = '';
                showToast('Foto removida com sucesso!', 'success');
            } else {
                showToast(data.error || 'Erro ao remover foto', 'error');
            }
        } catch (error) {
            removeFotoBtn.disabled = false;
            showToast('Erro ao remover foto: ' + error.message, 'error');
        }
    });
}

/**
 * Recorta a imagem para formato quadrado (crop central) via canvas.
 * Retorna uma string base64 data:image/png;base64,...
 */
function cropSquare(base64Src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const size = Math.min(img.width, img.height);
            const sx = (img.width - size) / 2;
            const sy = (img.height - size) / 2;
            const canvas = document.createElement('canvas');
            // Limitar a 512x512 para manter tamanho razoável
            const outSize = Math.min(size, 512);
            canvas.width = outSize;
            canvas.height = outSize;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, sx, sy, size, size, 0, 0, outSize, outSize);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = reject;
        img.src = base64Src;
    });
}

// === FORMULÁRIO ===
function setupForm() {
    const form = document.getElementById('perfilForm');
    if (!form) {
        console.error('❌ Elemento perfilForm não encontrado no HTML');
        return;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('💾 Iniciando salvamento do perfil...');

        // Helper para pegar valor de ID com segurança
        const getVal = (id) => {
            const el = document.getElementById(id);
            return el ? el.value.trim() : '';
        };

        const nome = getVal('nome');
        if (!nome) {
            showToast('O nome é obrigatório', 'error');
            return;
        }

        // Coleta dados atualizados com segurança
        const cpfRaw = getVal('cpf').replace(/\D/g, ''); // Remove formatação
        const telefoneRaw = getVal('telefone').replace(/\D/g, ''); // Remove formatação

        // Validações
        if (cpfRaw.length !== 11) {
            showToast('CPF inválido. Digite 11 dígitos.', 'error');
            hideLoading(form.querySelector('button[type="submit"]'));
            return;
        }

        if (telefoneRaw.length < 10 || telefoneRaw.length > 11) {
            showToast('Telefone inválido', 'error');
            hideLoading(form.querySelector('button[type="submit"]'));
            return;
        }

        const dadosAtualizados = {
            ...perfilAtual,
            nome: nome,
            cpf: cpfRaw,
            telefone: telefoneRaw,
            idade: parseInt(document.getElementById('idade')?.value) || 0,
            biografia: getVal('biografia'),
            atualizadoEm: new Date().toISOString()
        };

        // Escolas/Disciplinas apenas se for professor
        if (tipoPerfilAtual === 'professor') {
            dadosAtualizados.escola = getVal('escola');
            dadosAtualizados.disciplina = getVal('disciplina');
            dadosAtualizados.atividadesPessoais = getVal('atividadesPessoais');
            dadosAtualizados.ideiasParaAno = getVal('ideiasParaAno');
        }

        // A foto agora é enviada imediatamente no listener do input (setado no setupPhotoUpload)
        // Não precisamos mais fazer upload durante o submit do formulário principal.
        
        // Mantemos apenas a referência da foto atual que já foi sincronizada
        const user = auth.getCurrentUser();
        dadosAtualizados.foto = user.foto || perfilAtual.foto || '';

        // Loading
        const submitBtn = form.querySelector('button[type="submit"]');
        showLoading(submitBtn);

        try {
            let storeName = 'usuarios';
            if (tipoPerfilAtual === 'professor') storeName = 'professores';
            else if (tipoPerfilAtual === 'diretor') storeName = 'diretores';

            console.log(`📤 Enviando para ${storeName}:`, dadosAtualizados);

            if (dadosAtualizados.isNew) {
                console.log('🆕 Criando novo registro de perfil...');
                const tempNew = { ...dadosAtualizados };
                delete tempNew.isNew;
                await db.add(storeName, tempNew);
            } else {
                console.log('📝 Atualizando registro existente...');
                await db.update(storeName, dadosAtualizados);
            }

            // Atualiza também na collection 'usuarios' para sincronizar CPF, telefone e FOTO
            const sessionUser = auth.getCurrentUser();
            const usuarioAtualizado = await db.getById('usuarios', sessionUser._id || sessionUser.id);
            if (usuarioAtualizado) {
                usuarioAtualizado.cpf = cpfRaw;
                usuarioAtualizado.telefone = telefoneRaw;
                usuarioAtualizado.nome = nome;
                usuarioAtualizado.foto = dadosAtualizados.foto; // SINCRONIZA FOTO
                await db.update('usuarios', usuarioAtualizado);
                
                // Atualiza a sessão e a interface global
                const finalUser = { ...auth.getCurrentUser(), ...usuarioAtualizado };
                auth.updateSession(finalUser);
                
                if (window.updateAllAvatars) {
                    window.updateAllAvatars(finalUser);
                }
                console.log('✅ CPF, telefone e Foto atualizados em usuarios');
            }

            if (tipoPerfilAtual === 'admin') {
                const finalAdmin = { ...auth.getCurrentUser(), ...dadosAtualizados, cpf: cpfRaw, telefone: telefoneRaw };
                auth.updateSession(finalAdmin);
                if (window.updateAllAvatars) {
                    window.updateAllAvatars(finalAdmin);
                }
            }

            // Exibe confirmação visual forte
            showToast('Alterações salvas com sucesso!', 'success');
            console.log('✅ Perfil salvo com sucesso!');

            // Aguarda e redireciona
            await sleep(1500);
            window.location.href = 'dashboard.html';

        } catch (error) {
            console.error('❌ Erro crítico ao salvar perfil:', error);
            showToast('Erro ao salvar: ' + (error.message || 'Erro desconhecido'), 'error');
            hideLoading(submitBtn);
        }
    });
}

// === NAVEGAÇÍO ===
function voltarDashboard() {
    window.location.href = 'dashboard.html';
}

async function sair() {
    const confirmacao = confirm('Deseja realmente sair do sistema?');
    if (confirmacao) {
        try {
            await auth.logout();
        } catch (error) {
            console.error('Erro ao sair:', error);
            sessionStorage.clear();
            window.location.href = 'login.html';
        }
    }
}

// === FERRAMENTAS (ADMIN) ===
function abrirFerramentas() {
    const user = auth.getCurrentUser();

    // Verifica se é administrador
    if (user.perfil !== 'admin') {
        showToast('Acesso negado. Apenas administradores podem acessar as ferramentas.', 'error');
        return;
    }

    // Redireciona para página de ferramentas
    // TODO: Criar página ferramentas.html dedicada
    // Por enquanto, redireciona para limpar-dados.html (ferramenta existente)
    window.location.href = 'utils/limpar-dados.html';
}

// === INPUT MASKS ===
function setupInputMasks() {
    // Máscara de CPF
    const cpfInput = document.getElementById('cpf');
    if (cpfInput) {
        cpfInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 11) value = value.slice(0, 11);

            // Formata: 000.000.000-00
            value = value.replace(/(\d{3})(\d)/, '$1.$2');
            value = value.replace(/(\d{3})(\d)/, '$1.$2');
            value = value.replace(/(\d{3})(\d{1,2})$/, '$1-$2');

            e.target.value = value;
        });
    }

    // Máscara de Telefone
    const telefoneInput = document.getElementById('telefone');
    if (telefoneInput) {
        telefoneInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 11) value = value.slice(0, 11);

            // Formata: (00) 00000-0000 ou (00) 0000-0000
            if (value.length <= 10) {
                value = value.replace(/(\d{2})(\d)/, '($1) $2');
                value = value.replace(/(\d{4})(\d)/, '$1-$2');
            } else {
                value = value.replace(/(\d{2})(\d)/, '($1) $2');
                value = value.replace(/(\d{5})(\d)/, '$1-$2');
            }

            e.target.value = value;
        });
    }
}

// === AVALIAÇÃO DO SISTEMA ===
function setupAvaliacao() {
    const btnEnviar = document.getElementById('btnEnviarAvaliacao');
    if (!btnEnviar) return;

    const stars = document.querySelectorAll('input[name="estrelas"]');
    const labels = document.querySelectorAll('#ratingStars label');
    const ratingContainer = document.getElementById('ratingStars');
    
    let selectedIndex = -1; // -1 means no rating selected yet

    function updateStarColors(limitIndex) {
        labels.forEach((lbl, i) => {
            const icon = lbl.querySelector('i');
            if (icon) {
                if (i <= limitIndex) {
                    icon.style.color = '#fbbf24'; // Beautiful glowing gold fallback
                    icon.style.textShadow = '0 0 8px rgba(251, 191, 36, 0.4)';
                    icon.className = 'bi bi-star-fill';
                } else {
                    icon.style.color = '#475569';
                    icon.style.textShadow = 'none';
                    icon.className = 'bi bi-star';
                }
            }
        });
    }

    labels.forEach((label, index) => {
        // Hover state
        label.addEventListener('mouseenter', () => {
            updateStarColors(index);
        });

        // Click state
        label.addEventListener('click', (e) => {
            e.preventDefault(); // Prevent double triggering
            selectedIndex = index;
            if (stars[index]) {
                stars[index].checked = true;
            }
            updateStarColors(index);
        });
    });

    // Restore state when mouse leaves container
    if (ratingContainer) {
        ratingContainer.addEventListener('mouseleave', () => {
            updateStarColors(selectedIndex);
        });
    }

    btnEnviar.addEventListener('click', async () => {
        const starSelecionada = document.querySelector('input[name="estrelas"]:checked');
        const texto = document.getElementById('avaliacaoTexto').value.trim();

        if (selectedIndex === -1 && !starSelecionada) {
            showToast('Por favor, selecione de 1 a 5 estrelas', 'warning');
            return;
        }
        if (!texto) {
            showToast('Por favor, deixe um comentário', 'warning');
            return;
        }

        const btnOriginalText = btnEnviar.innerHTML;
        btnEnviar.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Enviando...';
        btnEnviar.disabled = true;

        try {
            const ratingValue = starSelecionada ? parseInt(starSelecionada.value) : (selectedIndex + 1);
            const baseUrl = window.API_BASE_URL || (window.location.hostname === 'localhost' ? `http://${window.location.hostname}:3001/api` : 'https://sistema-escolar-bfty.onrender.com/api');
            const res = await fetch(`${baseUrl}/avaliacoes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    estrelas: ratingValue,
                    texto: texto
                }),
                credentials: 'include'
            });

            const data = await res.json();
            if (data.success) {
                showToast('Avaliação enviada! Obrigado pelo feedback.', 'success');
                document.getElementById('avaliacaoTexto').value = '';
                // Limpar estrelas
                stars.forEach(s => s.checked = false);
                selectedIndex = -1;
                updateStarColors(-1);
            } else {
                showToast(data.error || 'Erro ao enviar avaliação', 'error');
            }
        } catch (error) {
            console.error('Erro avaliacao:', error);
            showToast('Erro de conexão com o servidor', 'error');
        } finally {
            btnEnviar.innerHTML = btnOriginalText;
            btnEnviar.disabled = false;
        }
    });
}
