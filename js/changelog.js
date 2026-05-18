/**
 * changelog.js — Sistema de Notificações de Atualizações
 * Usa Bootstrap Icons em vez de emojis para visual consistente.
 */

const CHANGELOG = [
    {
        id: 'update-2025-05-15-pwa',
        data: '15/05/2025',
        icone: 'bi-phone',
        titulo: 'App agora pode ser instalado no celular!',
        descricao: 'Você pode instalar o Sistema Escolar direto no celular como se fosse um app. Clique nos 3 pontinhos do navegador e escolha "Adicionar à tela inicial".',
        tag: 'novo'
    },
    {
        id: 'update-2025-05-15-meusdados',
        data: '15/05/2025',
        icone: 'bi-shield-check',
        titulo: 'Novo portal de privacidade (LGPD)',
        descricao: 'Agora você pode acessar, baixar e solicitar a exclusão dos seus dados pessoais. Clique em "Privacidade" no menu superior ou no card "Meus Dados".',
        tag: 'novo'
    },
    {
        id: 'update-2025-05-15-email-verificacao',
        data: '15/05/2025',
        icone: 'bi-envelope-check',
        titulo: 'Verificação de e-mail no cadastro',
        descricao: 'Ao criar uma nova conta, um e-mail de confirmação é enviado automaticamente. Isso garante que só contas reais acessem o sistema.',
        tag: 'segurança'
    },
    {
        id: 'update-2025-05-15-2fa',
        data: '15/05/2025',
        icone: 'bi-shield-lock',
        titulo: 'Login com verificação em dois fatores (2FA)',
        descricao: 'Administradores e diretores agora recebem um código por e-mail ao fazer login. Isso protege sua conta mesmo que alguém descubra sua senha.',
        tag: 'segurança'
    },
    {
        id: 'update-2025-05-15-bloqueio',
        data: '15/05/2025',
        icone: 'bi-shield-exclamation',
        titulo: 'Proteção contra tentativas repetidas de login',
        descricao: 'Se alguém tentar adivinhar sua senha várias vezes seguidas, a conta é bloqueada por 15 minutos automaticamente e os administradores são avisados.',
        tag: 'segurança'
    },
    {
        id: 'update-2025-05-15-notas',
        data: '15/05/2025',
        icone: 'bi-bar-chart-line',
        titulo: 'Módulo de notas melhorado',
        descricao: 'As notas agora são validadas automaticamente (devem estar entre 0 e 10). Também foi adicionada a geração de boletim por aluno e cálculo de médias por bimestre.',
        tag: 'melhoria'
    },
    {
        id: 'update-2025-05-15-notificacoes-email',
        data: '15/05/2025',
        icone: 'bi-bell',
        titulo: 'Notificações automáticas por e-mail',
        descricao: 'O sistema agora envia e-mails automáticos para os administradores em caso de tentativas de invasão e quando o código secreto da escola é trocado.',
        tag: 'melhoria'
    },
    {
        id: 'update-2025-05-15-lgpd',
        data: '15/05/2025',
        icone: 'bi-file-earmark-text',
        titulo: 'Conformidade com a LGPD',
        descricao: 'Adicionamos política de privacidade, consentimento no cadastro e exclusão automática de dados de contas inativas há mais de 12 meses.',
        tag: 'compliance'
    }
];

const tagCfg = {
    'novo':       { bg: 'rgba(26,86,219,0.15)',  color: '#60a5fa',  label: 'Novidade',  icon: 'bi-stars' },
    'segurança':  { bg: 'rgba(239,68,68,0.1)',   color: '#f87171',  label: 'Segurança', icon: 'bi-lock-fill' },
    'melhoria':   { bg: 'rgba(34,197,94,0.1)',   color: '#4ade80',  label: 'Melhoria',  icon: 'bi-arrow-up-circle' },
    'compliance': { bg: 'rgba(245,158,11,0.1)',  color: '#fbbf24',  label: 'Compliance',icon: 'bi-clipboard-check' }
};

const STORAGE_KEY = 'escola_notif_lidas_v1';

function getNotifLidas() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

function marcarComoLida(id) {
    const lidas = getNotifLidas();
    if (!lidas.includes(id)) { lidas.push(id); localStorage.setItem(STORAGE_KEY, JSON.stringify(lidas)); }
}

function marcarTodasLidas() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(CHANGELOG.map(n => n.id)));
    document.querySelectorAll('.notif-item').forEach(el => el.classList.add('lida'));
    document.querySelectorAll('.notif-dot').forEach(el => el.remove());
    atualizarBadge();
}

function atualizarBadge() {
    const lidas = getNotifLidas();
    const naoLidas = CHANGELOG.filter(n => !lidas.includes(n.id)).length;
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    badge.textContent = naoLidas;
    badge.style.display = naoLidas > 0 ? 'flex' : 'none';
}

function renderChangelog() {
    const lidas = getNotifLidas();
    const container = document.getElementById('notif-list');
    if (!container) return;

    container.innerHTML = CHANGELOG.map(n => {
        const isLida = lidas.includes(n.id);
        const tag = tagCfg[n.tag] || tagCfg['melhoria'];
        return `
        <div class="notif-item${isLida ? ' lida' : ''}" data-id="${n.id}">
            <div class="notif-icon-wrap">
                <i class="bi ${n.icone}"></i>
            </div>
            <div class="notif-body">
                <div class="notif-top">
                    <span class="notif-tag" style="background:${tag.bg};color:${tag.color};">
                        <i class="bi ${tag.icon}"></i> ${tag.label}
                    </span>
                    <span class="notif-data">${n.data}</span>
                </div>
                <strong class="notif-titulo">${n.titulo}</strong>
                <p class="notif-desc">${n.descricao}</p>
            </div>
            ${!isLida ? '<div class="notif-dot"></div>' : ''}
        </div>`;
    }).join('');

    container.querySelectorAll('.notif-item').forEach(el => {
        el.addEventListener('click', () => {
            marcarComoLida(el.dataset.id);
            el.classList.add('lida');
            const dot = el.querySelector('.notif-dot');
            if (dot) dot.remove();
            atualizarBadge();
        });
    });
}

function toggleNotifPanel() {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    const isOpen = panel.classList.toggle('open');
    if (isOpen) renderChangelog();
}

document.addEventListener('click', (e) => {
    const panel = document.getElementById('notif-panel');
    const btn = document.getElementById('notif-btn');
    if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
        panel.classList.remove('open');
    }
});

document.addEventListener('DOMContentLoaded', atualizarBadge);
