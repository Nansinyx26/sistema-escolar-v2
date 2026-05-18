const nodemailer = require('nodemailer');

class EmailService {
    constructor() {
        // Configuração do Resend (SMTP)
        // A senha deve ser a API Key do Resend (começa com 're_')
        this.transporter = nodemailer.createTransport({
            host: 'smtp.resend.com',
            port: 465,
            secure: true,
            auth: {
                user: 'resend',
                pass: process.env.EMAIL_PASS
            }
        });
    }

    async sendPasswordReset(email, resetLink) {
        // No Resend, usamos apenas a API Key (pass)
        if (!process.env.EMAIL_PASS && !this.transporter.options.auth.pass) {
            console.warn('⚠️ API Key do Resend não configurada.');
            console.log(`🔗 Link (Backup Log): ${resetLink}`);
            return;
        }

        const mailOptions = {
            // onboarding@resend.dev é obrigatório para testes sem domínio próprio
            from: 'Sistema Escolar <onboarding@resend.dev>',
            to: email,
            subject: 'Recuperação de Senha - Sistema Escolar',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="color: #2c3e50;">Redefinição de Senha</h2>
                    </div>
                    <p style="color: #555; font-size: 16px;">Olá,</p>
                    <p style="color: #555; font-size: 16px;">Recebemos uma solicitação para redefinir a senha da sua conta no Sistema Escolar.</p>
                    <p style="color: #555; font-size: 16px;">Clique no botão abaixo para criar uma nova senha:</p>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${resetLink}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Redefinir Minha Senha</a>
                    </div>

                    <p style="color: #999; font-size: 14px;">Se você não solicitou esta alteração, pode ignorar este email com segurança.</p>
                    <p style="color: #999; font-size: 14px;">Este link expira em 1 hora.</p>
                    
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="color: #aaa; font-size: 12px; text-align: center;">Sistema Escolar &copy; ${new Date().getFullYear()}</p>
                </div>
            `
        };

        try {
            const info = await this.transporter.sendMail(mailOptions);
            console.log('✅ Email (Resend) enviado para:', email, 'ID:', info.messageId);
            return info;
        } catch (error) {
            console.error('❌ Erro ao enviar email (Resend):', error);
            // Fallback: mostra no console para não travar o dev
            console.log(`🔗 Link (Erro no Envio): ${resetLink}`);
            throw new Error('Falha ao enviar email de recuperação');
        }
    }

    async sendVerificationCode(email, code) {
        if (!process.env.EMAIL_PASS && !this.transporter.options.auth.pass) {
            console.warn('⚠️ API Key do Resend não configurada.');
            console.log(`🔢 Código (Backup Log): ${code}`);
            return;
        }

        const mailOptions = {
            from: 'Sistema Escolar <onboarding@resend.dev>',
            to: email,
            subject: 'Código de Verificação - Sistema Escolar',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="color: #2c3e50;">Recuperação de Senha</h2>
                    </div>
                    <p style="color: #555; font-size: 16px;">Olá,</p>
                    <p style="color: #555; font-size: 16px;">Você solicitou a recuperação de senha da sua conta no Sistema Escolar.</p>
                    <p style="color: #555; font-size: 16px;">Use o código abaixo para redefinir sua senha:</p>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <div style="background-color: #f5f5f5; border: 2px dashed #4CAF50; padding: 20px; border-radius: 10px; display: inline-block;">
                            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #2c3e50;">${code}</span>
                        </div>
                    </div>

                    <p style="color: #999; font-size: 14px;">Se você não solicitou esta alteração, pode ignorar este email com segurança.</p>
                    <p style="color: #999; font-size: 14px;">Este código expira em 15 minutos.</p>
                    
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="color: #aaa; font-size: 12px; text-align: center;">Sistema Escolar &copy; ${new Date().getFullYear()}</p>
                </div>
            `
        };

        try {
            const info = await this.transporter.sendMail(mailOptions);
            console.log('✅ Email de código (Resend) enviado para:', email, 'ID:', info.messageId);
            return info;
        } catch (error) {
            console.error('❌ Erro ao enviar email (Resend):', error);
            console.log(`🔢 Código (Erro no Envio): ${code}`);
            throw new Error(`Falha SMTP: ${error.message}`);
        }
    }
}

module.exports = new EmailService();
