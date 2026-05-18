/**
 * direcao-notificacoes.js
 * Central de Notificações do Diretor
 */

let notificacoes = [];
let notificacaoEditando = null;

// Inicialização
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await db.init();
        await auth.init();

        // Verifica autenticação e permissão de diretor
        if (!auth.isAuthenticated()) {
            window.location.href = '../index.html';
            return;
        }

        const user = auth.getCurrentUser();
        if (user.perfil !== 'diretor' && user.perfil !== 'admin') {
            showToast('Acesso negado. Apenas diretores podem acessar esta página.', 'error');
            window.location.href = '../dashboard.html';
            return;
        }

        await carregarListaTurmas();
        carregarNotificacoes();
    } catch (error) {
        console.error('Erro na inicialização:', error);
        carregarNotificacoes(); // Demo mode
    }
});

// Carregar notificações do banco
async function carregarNotificacoes() {
    try {
        const notifs = await db.getAll('notificacoes') || [];
        notificacoes = notifs.sort((a, b) => new Date(b.dataCriacao) - new Date(a.dataCriacao));
    } catch (e) {
        console.warn('Usando modo demo');
        notificacoes = _demoNotificacoes();
    }
    renderizarHistorico();
}

// Abrir modal de nova notificação
function abrirNovaNotificacao() {
    document.getElementById('formNotificacao').reset();
    document.getElementById('tipoNotif').value = 'info';
    document.getElementById('tituloNotif').focus();
    atualizarPreview();
}

// Alterar a seleção de destinatário
function mudarTipoDestinatario() {
    const tipoDest = document.querySelector('input[name="tipoDest"]:checked').value;
    const turmaContainer = document.getElementById('turmaSelectContainer');
    const alunoContainer = document.getElementById('alunoSelectContainer');
    const selectTurma = document.getElementById('selectTurma');
    const selectAluno = document.getElementById('selectAluno');
    
    if (tipoDest === 'todos') {
        turmaContainer.style.display = 'none';
        alunoContainer.style.display = 'none';
        selectTurma.value = '';
        selectAluno.innerHTML = '<option value="">Primeiro selecione a turma acima...</option>';
        selectAluno.disabled = true;
    } else if (tipoDest === 'turma') {
        turmaContainer.style.display = 'block';
        alunoContainer.style.display = 'none';
        selectAluno.innerHTML = '<option value="">Primeiro selecione a turma acima...</option>';
        selectAluno.disabled = true;
    } else if (tipoDest === 'aluno') {
        turmaContainer.style.display = 'block';
        alunoContainer.style.display = 'block';
        if (selectTurma.value) {
            aoSelecionarTurma();
        }
    }
    atualizarPreview();
}

async function aoSelecionarTurma() {
    const tipoDest = document.querySelector('input[name="tipoDest"]:checked').value;
    const selectTurma = document.getElementById('selectTurma');
    const selectAluno = document.getElementById('selectAluno');
    
    if (tipoDest === 'aluno' && selectTurma.value) {
        selectAluno.disabled = false;
        selectAluno.innerHTML = '<option value="">Carregando alunos...</option>';
        
        try {
            let alunos = await db.getByIndex('alunos', 'turma', selectTurma.value);
            
            alunos.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
            
            selectAluno.innerHTML = '<option value="">Selecione o aluno correspondente...</option>';

            alunos.forEach(aluno => {
                const option = document.createElement('option');
                option.value = aluno.id || aluno._id;
                const nomeCompleto = `${aluno.nome} ${aluno.sobrenome || ''}`.trim();
                const temResponsavel = !!(aluno.responsavel && String(aluno.responsavel).trim());
                // Prefixo emoji: ✅ responsável vinculado | ⚠️ sem responsável
                const prefixo = temResponsavel ? '✅' : '⚠️';
                const sufixo = temResponsavel
                    ? ` — ${aluno.responsavel}`
                    : ' — Sem responsável';
                option.textContent = `${prefixo} ${nomeCompleto}${sufixo}`;
                // Armazena dados para uso posterior
                option.dataset.temResponsavel = temResponsavel ? '1' : '0';
                option.dataset.responsavel = aluno.responsavel || '';
                selectAluno.appendChild(option);
            });
            
            if (alunos.length === 0) {
                selectAluno.innerHTML = '<option value="">Nenhum aluno encontrado nesta turma.</option>';
                selectAluno.disabled = true;
            }
        } catch (e) {
            console.error('Erro ao carregar alunos:', e);
            selectAluno.innerHTML = '<option value="">Erro ao carregar.</option>';
        }
    } else if (tipoDest === 'aluno') {
        selectAluno.innerHTML = '<option value="">Primeiro selecione a turma acima...</option>';
        selectAluno.disabled = true;
    }
    atualizarPreview();
}

// Atualiza badge visual do responsável quando um aluno é selecionado
function atualizarBadgeResponsavel() {
    const select = document.getElementById('selectAluno');
    const badge  = document.getElementById('badgeResponsavel');
    if (!select || !badge) return;

    const selected = select.options[select.selectedIndex];
    if (!selected || !selected.value) {
        badge.style.display = 'none';
        select.style.borderColor = '';
        return;
    }

    const temResponsavel = selected.dataset.temResponsavel === '1';
    const responsavel    = selected.dataset.responsavel || '';

    badge.style.display = 'flex';
    badge.style.alignItems = 'center';
    badge.style.gap = '6px';

    if (temResponsavel) {
        select.style.borderColor = '#22c55e';
        select.style.boxShadow   = '0 0 0 2px rgba(34,197,94,0.2)';
        badge.innerHTML = `
            <span style="display:inline-flex;align-items:center;gap:5px;background:rgba(34,197,94,0.12);
                color:#22c55e;padding:4px 10px;border-radius:20px;border:1px solid rgba(34,197,94,0.3);">
                <i class="bi bi-person-check-fill"></i>
                <strong>Responsável:</strong> ${responsavel}
            </span>`;
    } else {
        select.style.borderColor = '#ef4444';
        select.style.boxShadow   = '0 0 0 2px rgba(239,68,68,0.2)';
        badge.innerHTML = `
            <span style="display:inline-flex;align-items:center;gap:5px;background:rgba(239,68,68,0.12);
                color:#ef4444;padding:4px 10px;border-radius:20px;border:1px solid rgba(239,68,68,0.3);">
                <i class="bi bi-person-x-fill"></i>
                Nenhum responsável vinculado
            </span>`;
    }
}

// Carregar lista de turmas dinamicamente do banco de dados
async function carregarListaTurmas() {
    try {
        const turmas = await db.getAll('turmas') || [];
        const select = document.getElementById('selectTurma');
        if (!select) return;

        // Limpar opções existentes mantendo apenas a primeira
        select.innerHTML = '<option value="">Selecione uma turma...</option>';
        
        // Ordenar as turmas
        turmas.sort((a, b) => {
            const idA = String(a.id || '').toUpperCase();
            const idB = String(b.id || '').toUpperCase();
            return idA.localeCompare(idB, undefined, { numeric: true });
        });
        
        turmas.forEach(t => {
            if (!t.id) return;
            const option = document.createElement('option');
            option.value = t.id;
            
            const label = (t.ano && t.sala) ? `${t.ano}º Ano ${t.sala}` : `Turma ${t.id}`;
            option.textContent = label;
            
            select.appendChild(option);
        });
    } catch (e) {
        console.error('Erro ao carregar turmas:', e);
    }
}

// Atualizar preview em tempo real
function atualizarPreview() {
    const tipo = document.getElementById('tipoNotif').value;
    const titulo = document.getElementById('tituloNotif').value || 'Título aqui';
    const mensagem = document.getElementById('mensagemNotif').value || 'Digite a mensagem para visualizar...';
    
    const iconMap = {
        'info': '📢',
        'aviso': '⚠️',
        'evento': '🎉',
        'financeiro': '💰',
        'academico': '📚',
        'saude': '🏥',
        'falta': '📋'
    };
    
    const tipoMap = {
        'info': 'Informativo Geral',
        'aviso': 'Aviso Importante',
        'evento': 'Evento da Escola',
        'financeiro': 'Financeiro',
        'academico': 'Desempenho Acadêmico',
        'saude': 'Saúde/Segurança',
        'falta': 'Falta/Ausência'
    };
    
    const preview = document.getElementById('previewNotificacao');
    const icon = iconMap[tipo] || '📢';
    const tipoLabel = tipoMap[tipo] || 'Informativo Geral';
    
    preview.innerHTML = `
        <p style="color: var(--accent-primary); font-weight: 600; margin-bottom: 0.5rem;">
            ${icon} ${tipoLabel}
        </p>
        <p style="color: var(--text-primary); font-weight: 600; margin-bottom: 0.5rem;">
            ${titulo}
        </p>
        <p style="white-space: pre-wrap;">
            ${mensagem}
        </p>
    `;
}

// Salvar notificação
async function salvarNotificacao(event) {
    event.preventDefault();
    
    const tipo = document.getElementById('tipoNotif').value;
    const titulo = document.getElementById('tituloNotif').value;
    const mensagem = document.getElementById('mensagemNotif').value;
    const dataAgend = document.getElementById('dataAgend').value;
    const horaAgend = document.getElementById('horaAgend').value;
    
    if (!titulo) {
        showToast('Por favor, insira um título', 'warning');
        return;
    }

    const tipoDest = document.querySelector('input[name="tipoDest"]:checked').value;
    let destinatarios = null;

    if (tipoDest === 'todos') {
        destinatarios = 'todos';
    } else if (tipoDest === 'turma') {
        destinatarios = document.getElementById('selectTurma').value;
    } else if (tipoDest === 'aluno') {
        destinatarios = document.getElementById('selectAluno').value;
    }
    
    if (!destinatarios) {
        showToast('Selecione os destinatários (todos, turma ou aluno)', 'warning');
        return;
    }
    
    const novaNotif = {
        id: 'notif_' + Date.now(),
        tipo,
        titulo,
        mensagem,
        destinatarios,
        dataCriacao: new Date().toISOString(),
        dataEnvio: dataAgend && horaAgend ? new Date(`${dataAgend}T${horaAgend}`).toISOString() : new Date().toISOString(),
        status: dataAgend && horaAgend ? 'agendado' : 'enviado',
        lido: [],
        confirmacao: []
    };
    
    try {
        // Envia para o banco de dados via API
        const resultado = await db.add('notificacoes', novaNotif);
        
        if (resultado) {
            notificacoes.unshift(resultado);
            document.getElementById('formNotificacao').reset();
            
            showToast(
                resultado.status === 'agendado' 
                    ? `Notificação agendada para ${formatarData(resultado.dataEnvio)}` 
                    : 'Notificação enviada com sucesso!',
                'success'
            );
            
            // Reload the list from the database just to be sure
            carregarNotificacoes();
        } else {
            showToast('Erro ao enviar notificação para o servidor', 'error');
        }
    } catch (error) {
        console.error('Erro ao salvar notificação:', error);
        showToast('Erro ao enviar notificação', 'error');
    }
}

// Renderizar histórico
function renderizarHistorico() {
    const tbody = document.getElementById('historico');
    
    if (notificacoes.length === 0) {
        tbody.innerHTML = `
            <tr style="text-align: center; color: var(--text-tertiary);">
                <td colspan="6">Nenhuma notificação enviada ainda</td>
            </tr>
        `;
        return;
    }
    
    const tipoMap = {
        'info': 'Informativo',
        'aviso': 'Aviso',
        'evento': 'Evento',
        'financeiro': 'Financeiro',
        'academico': 'Acadêmico',
        'saude': 'Saúde',
        'falta': 'Falta'
    };
    
    tbody.innerHTML = notificacoes.map(n => {
        let destLabel = 'Todos';
        if (n.destinatarios !== 'todos') {
            // Check if it's an objectId-like or student-like ID versus a short class code like 5A
            if (n.destinatarios.length > 5) {
                destLabel = `Aluno ID: ${n.destinatarios.substring(0, 6)}...`;
            } else {
                destLabel = `Turma ${n.destinatarios}`;
            }
        }
        const dataEnvio = new Date(n.dataEnvio);
        const statusClass = n.status === 'enviado' ? 'nd-status-enviado' : 'nd-status-agendado';
        
        return `
            <tr>
                <td>${tipoMap[n.tipo] || n.tipo}</td>
                <td>${n.titulo}</td>
                <td>${destLabel}</td>
                <td>${formatarData(dataEnvio)}</td>
                <td>
                    <span class="nd-status-badge ${statusClass}">
                        ${n.status === 'enviado' ? '✓ Enviado' : '⏱ Agendado'}
                    </span>
                </td>
                <td>
                    <div style="display: flex; gap: 0.5rem;">
                        <button type="button" class="nd-btn nd-btn-secondary nd-btn-sm" onclick="verDetalhes('${n.id}')">
                            <i class="bi bi-eye"></i> Ver
                        </button>
                        <button type="button" class="nd-btn nd-btn-danger nd-btn-sm" onclick="deletarNotificacao('${n.id}')">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Ver detalhes da notificação
window.verDetalhes = function(notifId) {
    const notif = notificacoes.find(n => n.id === notifId);
    if (!notif) return;
    
    let destLabel = 'Todos os responsáveis';
    if (notif.destinatarios !== 'todos') {
        if (notif.destinatarios.length > 5) {
            destLabel = `Responsável do Aluno (ID: ${notif.destinatarios})`;
        } else {
            destLabel = `Turma ${notif.destinatarios}`;
        }
    }
    const dataEnvio = new Date(notif.dataEnvio);
    
    const confirmText = `
        <strong>Tipo:</strong> ${notif.tipo}<br>
        <strong>Título:</strong> ${notif.titulo}<br>
        <strong>Destinatários:</strong> ${destLabel}<br>
        <strong>Data de Envio:</strong> ${formatarData(dataEnvio)}<br>
        <strong>Status:</strong> ${notif.status === 'enviado' ? 'Enviado' : 'Agendado'}<br>
        <br>
        <strong>Mensagem:</strong><br>
        ${notif.mensagem}
    `;
    
    document.getElementById('confirmText').innerHTML = confirmText;
    document.getElementById('modalConfirm').classList.add('active');
};

// Deletar notificação
window.deletarNotificacao = async function(notifId) {
    if (!confirm('Tem certeza que deseja deletar esta notificação?')) return;
    
    try {
        const sucesso = await db.delete('notificacoes', notifId);
        if (sucesso !== false) { // might return true/false
            notificacoes = notificacoes.filter(n => (n.id || n._id) !== notifId);
            renderizarHistorico();
            showToast('Notificação removida', 'success');
        } else {
            showToast('Erro ao remover notificação', 'error');
        }
    } catch (error) {
        console.error('Erro ao deletar notificação:', error);
        showToast('Erro ao comunicar com o servidor', 'error');
    }
};

// Fechar modal
function fecharModal() {
    document.getElementById('modalConfirm').classList.remove('active');
}

// Confirmar envio (não faz nada, apenas fecha o modal)
function confirmarEnvio() {
    fecharModal();
}

// Funções auxiliares
function formatarData(data) {
    const d = new Date(data);
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const ano = d.getFullYear();
    const horas = String(d.getHours()).padStart(2, '0');
    const minutos = String(d.getMinutes()).padStart(2, '0');
    return `${dia}/${mes}/${ano} ${horas}:${minutos}`;
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#0ea5e9'};
        color: white;
        border-radius: 8px;
        font-weight: 600;
        z-index: 2000;
        animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Dados de demo
function _demoNotificacoes() {
    return [
        {
            id: 'notif_001',
            tipo: 'evento',
            titulo: 'Festa Junina 2026',
            mensagem: 'Convidamos todos os responsáveis para a Festa Junina da escola!\n\nData: 15 de junho\nHorário: 17h00 às 22h00\nLocal: Pátio da escola\n\nVenha aproveitar comidas típicas, quadrilhas, sorteios e diversão!',
            destinatarios: 'todos',
            dataCriacao: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
            dataEnvio: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
            status: 'enviado',
            lido: ['r1', 'r2'],
            confirmacao: ['r1']
        },
        {
            id: 'notif_002',
            tipo: 'academico',
            titulo: 'Boletim do 2º Bimestre',
            mensagem: 'O boletim do 2º bimestre já está disponível no portal do responsável!\n\nAcesse para acompanhar o desempenho acadêmico do seu filho.',
            destinatarios: '5A',
            dataCriacao: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            dataEnvio: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            status: 'enviado',
            lido: ['r2'],
            confirmacao: []
        },
        {
            id: 'notif_003',
            tipo: 'financeiro',
            titulo: 'Aviso de Mensalidade em Atraso',
            mensagem: 'Notificamos que a mensalidade do mês está em atraso.\n\nFavor regularizar a situação financeira assim que possível.\n\nDúvidas? Procure a secretaria.',
            destinatarios: 'todos',
            dataCriacao: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            dataEnvio: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            status: 'enviado',
            lido: [],
            confirmacao: []
        }
    ];
}

// Adicionar animação CSS se não existir
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
