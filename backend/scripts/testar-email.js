/**
 * Verifica se o envio de e-mail realmente funciona.
 *
 * Existe porque "a variável está preenchida" e "o e-mail chega" são coisas
 * diferentes: chave expirada, domínio não verificado no Resend ou porta
 * bloqueada falham exatamente igual. E o código 2FA é enviado com
 * `.catch(err => console.error(...))` em UserController — se falhar, o login
 * ainda responde requires2FA e pede um código que nunca chega. Antes de exigir
 * 2FA de um perfil, é isto aqui que precisa passar.
 *
 * Usa o MESMO transporter do sistema (utils/emailNotifications.js), então o que
 * passar aqui passa no login de verdade.
 *
 * Uso (dentro de backend/, com EMAIL_* preenchidas no .env):
 *   node scripts/testar-email.js seu-email@dominio.com
 */
require('dotenv').config();

const destino = process.argv[2];

if (!destino) {
    console.error('❌ Informe o destino: node scripts/testar-email.js voce@dominio.com');
    process.exit(1);
}

// Só reporta presença/ausência — nunca o valor, que é credencial.
const obrigatorias = ['EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USER', 'EMAIL_PASS'];
console.log('Configuração encontrada:');
const faltando = [];
for (const v of obrigatorias) {
    const definida = !!process.env[v];
    if (!definida) faltando.push(v);
    console.log(`  ${v.padEnd(12)} ${definida ? '✅ definida' : '⚠️  vazia'}`);
}
if (faltando.length === obrigatorias.length) {
    console.error('\n❌ Nenhuma variável de e-mail definida. Copie-as do painel do Render para backend/.env.');
    process.exit(1);
}
console.log('');

(async () => {
    const nodemailer = require('nodemailer');

    const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp.resend.com',
        port: Number(process.env.EMAIL_PORT) || 587,
        secure: Number(process.env.EMAIL_PORT) === 465,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    // 1) Handshake e autenticação — separa "credencial errada" de "envio recusado".
    try {
        await transporter.verify();
        console.log('✅ Conexão e autenticação SMTP OK');
    } catch (e) {
        console.error('❌ Falha na conexão/autenticação SMTP:', e.message);
        console.error('   Credencial inválida, porta bloqueada ou host errado. O 2FA NÃO funcionaria.');
        process.exit(1);
    }

    // 2) Envio real. O aceite do servidor ainda não garante a entrega na caixa —
    // por isso a confirmação final é você ver o e-mail chegar.
    const remetente = process.env.EMAIL_FROM || 'onboarding@resend.dev';
    try {
        const info = await transporter.sendMail({
            from: remetente,
            to: destino,
            subject: 'Teste de entrega — Sistema Escolar',
            text: 'Se você recebeu este e-mail, o envio do código 2FA vai funcionar.',
        });
        console.log('✅ Servidor aceitou a mensagem');
        console.log('   id:', info.messageId);
        console.log('   remetente:', remetente);
        if (info.rejected?.length) console.log('   ⚠️  rejeitados:', info.rejected.join(', '));
        console.log(`\n👉 Confira a caixa de ${destino} (e o spam). Chegou = pode exigir 2FA.`);
    } catch (e) {
        console.error('❌ Servidor recusou o envio:', e.message);
        console.error('   No Resend isso costuma ser domínio do remetente não verificado.');
        console.error('   Defina EMAIL_FROM com um endereço de domínio verificado.');
        process.exit(1);
    }
})();
