/**
 * anonimizacaoAutomatica.js
 * ============================================
 * IMPLEMENTAÇÍO: Anonimização Automática — Roadmap #14
 * Sprint: Setembro–Outubro 2026
 * ============================================
 * Cron job mensal que detecta usuários inativos há mais de 12 meses
 * e os anonimiza automaticamente, cumprindo a política de retenção LGPD.
 *
 * Fluxo:
 *   1. Todo dia 1 às 03:00, busca usuários com ultimoLogin > 12 meses atrás
 *   2. Envia e-mail de aviso 30 dias antes (quando ultimoLogin > 11 meses)
 *   3. Anonimiza efetivamente na marca dos 12 meses
 *
 * USO: Chamar startAnonimizacaoAutomatica() no index.js após o servidor iniciar.
 */

const cron = require('node-cron');
const Usuario = require('../models/Usuario');
const { logAction } = require('./auditHelper');
const nodemailer = require('nodemailer');

// Threshold: 12 meses = 365 dias
const THRESHOLD_ANONIMIZACAO_DIAS = 365;
// Aviso: 30 dias antes da anonimização (11 meses)
const THRESHOLD_AVISO_DIAS = 335;

// --------------------------------------------------
// Utilitário: Calcula a data X dias atrás
// --------------------------------------------------
function diasAtras(dias) {
    const d = new Date();
    d.setDate(d.getDate() - dias);
    return d;
}

// --------------------------------------------------
// Envia e-mail de aviso de anonimização iminente
// --------------------------------------------------
async function enviarAvisoAnonimizacao(usuario, transporter) {
    if (!transporter || !usuario.email || usuario.email.includes('@escola.anon')) return;

    try {
        await transporter.sendMail({
            from: process.env.EMAIL_FROM || `"Sistema Escolar" <noreply@escola.com>`,
            to: usuario.email,
            subject: '⚠️ Aviso LGPD: Seus dados serão anonimizados em 30 dias',
            html: `
                <div style="font-family:Arial,sans-serif;max-width:520px;padding:24px;border:1px solid #f59e0b;border-radius:8px;">
                    <h2 style="color:#b45309;">Aviso de Privacidade — LGPD</h2>
                    <p>Olá, <strong>${usuario.nome}</strong>.</p>
                    <p>Identificamos que sua conta no Sistema Escolar está <strong>inativa há 11 meses</strong>.</p>
                    <p>De acordo com nossa Política de Privacidade (LGPD), contas inativas por mais de 12 meses
                    têm seus dados pessoais anonimizados automaticamente.</p>
                    <p><strong>Você tem 30 dias</strong> para fazer login e manter sua conta ativa antes da anonimização.</p>
                    <a href="${process.env.FRONTEND_URL || 'http://localhost:3001'}/index.html"
                       style="display:inline-block;padding:10px 20px;background:#1a56db;color:white;text-decoration:none;border-radius:5px;margin:12px 0;">
                        Acessar o Sistema
                    </a>
                    <p style="color:#666;font-size:13px;">
                        Se você não quiser mais usar o sistema, pode ignorar este e-mail.
                        Seus dados serão anonimizados e a conta desativada.
                    </p>
                    <hr style="border:none;border-top:1px solid #eee;margin:16px 0;">
                    <p style="color:#aaa;font-size:12px;">E-mail automático — Sistema Escolar | LGPD Art. 18</p>
                </div>
            `
        });
        console.log(`📧 [LGPD] Aviso de anonimização enviado para ${usuario.email}`);
    } catch (err) {
        console.error(`[LGPD] Erro ao enviar aviso para ${usuario.email}:`, err.message);
    }
}

// --------------------------------------------------
// Executa a rotina de anonimização
// --------------------------------------------------
async function executarAnonimizacao(transporter) {
    console.log('🔄 [LGPD] Iniciando rotina de anonimização automática...');

    let anonimizados = 0;
    let avisoEnviados = 0;

    try {
        // --- FASE 1: Enviar aviso para usuários próximos ao threshold ---
        const dataAviso = diasAtras(THRESHOLD_AVISO_DIAS);
        const dataAnonimizacao = diasAtras(THRESHOLD_ANONIMIZACAO_DIAS);

        const usuariosParaAviso = await Usuario.find({
            ativo: true,
            anonimizadoEm: null,
            ultimoLogin: {
                $lte: dataAviso,   // Inativo há mais de 11 meses
                $gt: dataAnonimizacao  // Mas menos de 12 meses (ainda não será anonimizado)
            }
        }).select('_id email nome ultimoLogin').lean();

        for (const usuario of usuariosParaAviso) {
            await enviarAvisoAnonimizacao(usuario, transporter);
            avisoEnviados++;
        }

        // --- FASE 2: Anonimizar os que ultrapassaram 12 meses ---
        const usuariosParaAnonimizar = await Usuario.find({
            ativo: true,
            anonimizadoEm: null,
            ultimoLogin: { $lte: dataAnonimizacao }
        }).select('_id email nome ultimoLogin').lean();

        for (const usuario of usuariosParaAnonimizar) {
            const idAnonimo = `anon_${usuario._id}_${Date.now()}`;

            await Usuario.findByIdAndUpdate(usuario._id, {
                $set: {
                    nome: 'Usuário Anonimizado (LGPD)',
                    email: `${idAnonimo}@escola.anon`,
                    cpf: '000.000.000-00',
                    telefone: '(00) 00000-0000',
                    ativo: false,
                    senha: 'ANONIMIZADO_LGPD',
                    anonimizadoEm: new Date(),
                    foto: null,
                    resetToken: null,
                    resetTokenExpiry: null
                }
            });

            // Registra no audit log (sem req, é uma ação do sistema)
            await logAction(
                { ip: 'SISTEMA-CRON', user: { id: 'SISTEMA', email: 'cron@sistema', perfil: 'sistema' } },
                'AUTO_ANONYMIZE_USER',
                'Usuarios',
                {
                    recursoId: usuario._id,
                    descricao: `Usuário ${usuario.email} anonimizado automaticamente por inatividade (>${THRESHOLD_ANONIMIZACAO_DIAS} dias). Último login: ${usuario.ultimoLogin?.toISOString() || 'nunca'}`
                }
            );

            console.log(`✅ [LGPD] Anonimizado: ${usuario.email} (último login: ${usuario.ultimoLogin?.toLocaleDateString('pt-BR') || 'nunca'})`);
            anonimizados++;
        }

        console.log(`✅ [LGPD] Rotina concluída — Anonimizados: ${anonimizados} | Avisos enviados: ${avisoEnviados}`);

    } catch (err) {
        console.error('❌ [LGPD] Erro na rotina de anonimização:', err.message);
    }
}

// --------------------------------------------------
// Inicia o cron job
// --------------------------------------------------
function startAnonimizacaoAutomatica(transporter) {
    if (process.env.NODE_ENV !== 'production') {
        console.log('ℹ️  [LGPD] Anonimização automática desativada em desenvolvimento.');
        return;
    }

    // Executa todo dia 1 do mês às 03:00
    // Cron: '0 3 1 * *'  →  minuto=0, hora=3, dia=1, mês=*, dia-semana=*
    cron.schedule('0 3 1 * *', () => {
        executarAnonimizacao(transporter);
    }, {
        timezone: 'America/Sao_Paulo'
    });

    console.log('🔒 [LGPD] Cron de anonimização automática ativo — Executa todo dia 1 do mês às 03:00.');
}

module.exports = { startAnonimizacaoAutomatica, executarAnonimizacao };
