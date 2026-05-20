const API = () => window.API_BASE_URL ||
    ((location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'http://localhost:3001/api'
        : 'https://sistema-escolar-bfty.onrender.com/api');

// --- Auth check ---
const user = JSON.parse(sessionStorage.getItem('currentUser') || 'null');
if (!user) location.href = 'index.html';

// Se for professor, oculta as opções sensíveis da LGPD que são de controle administrativo
if (user && user.perfil === 'professor') {
    document.addEventListener('DOMContentLoaded', () => {
        const port = document.getElementById('lgpd-portabilidade');
        const exc = document.getElementById('lgpd-exclusao');
        if(port) port.style.display = 'none';
        if(exc) exc.style.display = 'none';
    });
}

// --- Toast ---
function toast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<i class="bi bi-${type === 'success' ? 'check-circle-fill' : 'x-circle-fill'}" style="color:${type === 'success' ? 'var(--success)' : 'var(--danger)'}"></i> ${msg}`;
    document.getElementById('toastContainer').appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

// --- Formatar data ---
function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// --- Mask CPF ---
function maskCPF(cpf) {
    if (!cpf) return '—';
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '***.$2.$3-**');
}

// --- Mask tel ---
function maskTel(t) {
    if (!t) return '—';
    return t.replace(/(\d{2})(\d{5})(\d{4})/, '($1) *****-$3');
}

// --- Load status ---
async function loadStatus() {
    try {
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(`${API()}/meus-dados/status-consentimento`, { credentials: 'include', signal: ctrl.signal });
        const d = await r.json();
        const c = d.consentimento || {};
        document.getElementById('statusBody').innerHTML = `
            <div class="status-row">
                <span class="status-label"><i class="bi bi-envelope-check"></i> E-mail verificado</span>
                <span class="badge ${c.emailVerificado ? 'badge-green' : 'badge-red'}">
                    <i class="bi bi-${c.emailVerificado ? 'check-circle' : 'x-circle'}"></i>
                    ${c.emailVerificado ? 'Verificado' : 'Pendente'}
                </span>
            </div>
            <div class="status-row">
                <span class="status-label"><i class="bi bi-shield-lock"></i> Autenticação 2FA</span>
                <span class="badge ${c.twoFactorAtivo ? 'badge-green' : 'badge-yellow'}">
                    <i class="bi bi-${c.twoFactorAtivo ? 'check-circle' : 'exclamation-circle'}"></i>
                    ${c.twoFactorAtivo ? 'Ativo' : 'Inativo'}
                </span>
            </div>
            <div class="status-row">
                <span class="status-label"><i class="bi bi-file-text"></i> Consentimento LGPD</span>
                <span class="badge ${c.aceiteEm ? 'badge-green' : 'badge-red'}">
                    ${c.aceiteEm ? 'Aceito em ' + fmtDate(c.aceiteEm) : 'Não registrado'}
                </span>
            </div>
        `;
    } catch {
        document.getElementById('statusBody').innerHTML = '<p style="color:var(--text-secondary)">Erro ao carregar status.</p>';
    }
}

// --- Load dados ---
function loadDados() {
    try {
        const u = user;
        document.getElementById('dadosGrid').innerHTML = `
            <div class="info-item"><label>Nome Completo</label><span>${u.nome || '—'}</span></div>
            <div class="info-item"><label>E-mail</label><span>${u.email || '—'}</span></div>
            <div class="info-item"><label>CPF</label><span>${maskCPF(u.cpf)}</span></div>
            <div class="info-item"><label>Telefone</label><span>${maskTel(u.telefone)}</span></div>
            <div class="info-item"><label>Perfil</label><span class="badge badge-blue"><i class="bi bi-person-badge"></i> ${u.perfil || '—'}</span></div>
            <div class="info-item"><label>Escola</label><span>${u.escola || '—'}</span></div>
            <div class="info-item"><label>Disciplina</label><span>${u.disciplina || '—'}</span></div>
            <div class="info-item"><label>Último Login</label><span>${fmtDate(u.ultimoLogin)}</span></div>
        `;
    } catch {
        document.getElementById('dadosGrid').innerHTML = '<p style="color:var(--text-secondary)">Erro ao carregar dados.</p>';
    }
}

// --- Load audit ---
function loadAudit() {
    // Audit is embedded in the export — show placeholder for now
    document.getElementById('auditBody').innerHTML = `
        <tr><td colspan="4" style="text-align:center; padding:2rem; color:var(--text-secondary);">
            <i class="bi bi-info-circle" style="display:block; font-size:1.5rem; margin-bottom:0.5rem;"></i>
            Histórico detalhado disponível no arquivo de exportação JSON.
        </td></tr>
    `;
}

// --- Exportar ---
document.getElementById('btnExportar').addEventListener('click', async () => {
    const btn = document.getElementById('btnExportar');
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Gerando arquivo...';
    try {
        const r = await fetch(`${API()}/meus-dados`, { credentials: 'include' });
        if (!r.ok) throw new Error('Erro na exportação');
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `meus-dados-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast('Arquivo baixado com sucesso!');
    } catch (e) {
        toast('Erro ao exportar dados.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-cloud-download"></i> Baixar Meus Dados (JSON)';
    }
});

// --- Modal Exclusão ---
document.getElementById('btnSolicitarExclusao').addEventListener('click', () => {
    document.getElementById('modalExclusao').classList.add('active');
});
document.getElementById('btnCancelarExclusao').addEventListener('click', () => {
    document.getElementById('modalExclusao').classList.remove('active');
});
document.getElementById('modalExclusao').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalExclusao'))
        document.getElementById('modalExclusao').classList.remove('active');
});

document.getElementById('btnConfirmarExclusao').addEventListener('click', async () => {
    const btn = document.getElementById('btnConfirmarExclusao');
    const motivo = document.getElementById('motivoExclusao').value;
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Enviando...';
    try {
        const r = await fetch(`${API()}/meus-dados/solicitar-exclusao`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ motivo })
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error);
        document.getElementById('modalExclusao').classList.remove('active');
        toast(`Solicitação enviada! Protocolo: ${d.protocolo}`);
    } catch (e) {
        toast(e.message || 'Erro ao enviar solicitação.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-send-check"></i> Confirmar Solicitação';
    }
});

// --- Boot ---
loadStatus();
loadDados();
loadAudit();
