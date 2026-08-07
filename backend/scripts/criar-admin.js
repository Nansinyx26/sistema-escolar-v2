/**
 * Provisiona (ou redefine) uma conta de administrador.
 *
 * NENHUMA credencial vive neste arquivo. O e-mail vem de variável de ambiente e
 * a senha, se não for informada, é sorteada na hora e impressa UMA única vez no
 * terminal — o banco guarda apenas o hash bcrypt.
 *
 * Uso (a partir de backend/):
 *   ADMIN_EMAIL=voce@escola.com node scripts/criar-admin.js
 *   ADMIN_EMAIL=voce@escola.com ADMIN_SENHA='...' node scripts/criar-admin.js   # senha própria
 *   ADMIN_EMAIL=voce@escola.com node scripts/criar-admin.js --reset             # troca a senha de uma conta já existente
 *
 * No PowerShell:
 *   $env:ADMIN_EMAIL='voce@escola.com'; node scripts/criar-admin.js
 *
 * Variáveis reconhecidas: ADMIN_EMAIL (obrigatória), ADMIN_SENHA, ADMIN_NOME,
 * ADMIN_TELEFONE. Todas podem ficar no backend/.env, que já está no .gitignore.
 */
require('dotenv').config();

const crypto = require('crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Mesmo custo usado pelo login em src/controllers/UserController.js.
const SALT_ROUNDS = 12;

const RESET = process.argv.includes('--reset');

/**
 * Senha aleatória de ~120 bits. Sem alfabeto "amigável" de propósito: a senha é
 * copiada uma vez para o gerenciador de senhas, não digitada de cabeça.
 *
 * Usa AMOSTRAGEM POR REJEIÇÃO em vez de `byte % alfabeto.length`. O alfabeto tem
 * 65 caracteres e 256 não é múltiplo de 65 (256 = 3×65 + 61), então o módulo
 * puro entrega os 61 primeiros caracteres com 4/256 de chance e os 4 últimos com
 * 3/256 — os primeiros saem 33% mais vezes. Aqui o viés não chega a quebrar a
 * senha, mas é o mesmo defeito que arruína geração de token e nonce, e o
 * conserto custa uma linha: descarta os bytes da faixa incompleta e sorteia de novo.
 */
function gerarSenha(tamanho = 20) {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?';
    const limite = 256 - (256 % alfabeto.length); // maior múltiplo de 65 <= 256
    let senha = '';
    while (senha.length < tamanho) {
        for (const b of crypto.randomBytes(tamanho)) {
            if (b >= limite) continue; // byte enviesado — descarta
            senha += alfabeto[b % alfabeto.length];
            if (senha.length === tamanho) break;
        }
    }
    return senha;
}

function abortar(mensagem) {
    console.error(`❌ ${mensagem}`);
    process.exit(1);
}

async function main() {
    const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    if (!email) {
        abortar('ADMIN_EMAIL não definida. Ex.: ADMIN_EMAIL=voce@escola.com node scripts/criar-admin.js');
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        abortar(`ADMIN_EMAIL inválida: ${email}`);
    }

    const uri = process.env.MONGODB_URI;
    if (!uri) {
        abortar('MONGODB_URI não definida. Preencha backend/.env (veja backend/.env.example).');
    }

    // Senha informada pelo operador ou sorteada aqui. `senhaGerada` controla se
    // ela deve ser exibida — uma senha que o operador já conhece não precisa ir
    // parar no scrollback do terminal.
    const senhaGerada = !process.env.ADMIN_SENHA;
    const senha = process.env.ADMIN_SENHA || gerarSenha();
    if (!senhaGerada && senha.length < 12) {
        abortar('ADMIN_SENHA muito curta (mínimo 12 caracteres). Omita a variável para gerar uma automaticamente.');
    }

    await mongoose.connect(uri, {
        dbName: process.env.MONGODB_DB_NAME || undefined,
        serverSelectionTimeoutMS: 10000
    });
    console.log('✅ Conectado ao MongoDB');

    const Usuario = require('../src/models/Usuario');
    const AuditLog = require('../src/models/AuditLog');

    // Todo caminho privilegiado do sistema grava auditoria (src/utils/auditHelper.js).
    // Este script cria a conta MAIS privilegiada que existe e roda fora do Express,
    // então não passa pelo logAction(req, ...) — sem este registro, a origem de um
    // admin no banco seria indistinguível de uma inserção maliciosa direta no Mongo.
    const auditar = async (acao, usuarioId, descricao) => {
        try {
            await AuditLog.create({
                usuarioId,
                usuarioNome: 'Script de provisionamento',
                usuarioEmail: email,
                perfil: 'admin',
                acao,
                recurso: 'Usuarios',
                recursoId: String(usuarioId),
                detalhes: { descricao },
                ip: 'cli',
                userAgent: `criar-admin.js (${require('os').hostname()})`,
                dispositivo: process.platform
            });
        } catch (e) {
            // Auditoria não pode derrubar o provisionamento, mas o silêncio aqui
            // seria pior que o erro: avisa para o operador registrar manualmente.
            console.warn(`⚠️  Conta gravada, mas o log de auditoria falhou: ${e.message}`);
        }
    };

    const existente = await Usuario.findOne({ email }).select('_id perfil');
    const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);

    if (existente) {
        if (!RESET) {
            abortar(
                `Já existe conta com ${email} (perfil: ${existente.perfil}). ` +
                'Rode com --reset para redefinir a senha e promover a admin.'
            );
        }
        await Usuario.updateOne({ _id: existente._id }, {
            $set: {
                senha: senhaHash,
                perfil: 'admin',
                ativo: true,
                deveMudarSenha: false,
                emailVerificado: true
            },
            // Invalida qualquer sessão/JWT emitido antes da troca de senha.
            $inc: { tokenVersion: 1 }
        });
        await auditar(
            'ADMIN_RESET',
            existente._id,
            `Senha redefinida e perfil promovido a admin (perfil anterior: ${existente.perfil}) via criar-admin.js`
        );
        console.log(`♻️  Conta ${email} atualizada para admin e com senha redefinida.`);
    } else {
        const novo = await Usuario.create({
            nome: process.env.ADMIN_NOME || 'Administrador',
            email,
            senha: senhaHash,
            telefone: process.env.ADMIN_TELEFONE || '(00) 00000-0000',
            perfil: 'admin',
            ativo: true,
            emailVerificado: true,
            deveMudarSenha: false,
            criadoEm: new Date()
        });
        await auditar('ADMIN_CREATED', novo._id, `Conta admin provisionada via criar-admin.js`);
        console.log(`✅ Conta admin criada: ${email}`);
    }

    if (senhaGerada) {
        // Fora de um terminal interativo, a saída está sendo capturada por
        // alguém: log de deploy, arquivo, pipeline de CI. Imprimir a senha ali
        // é gravá-la em texto plano num lugar que ninguém vai limpar depois.
        if (!process.stdout.isTTY) {
            console.warn('⚠️  Saída não é um terminal interativo — a senha vai parar no log/arquivo que capturou este comando.');
            console.warn('   Se isto for um build ou pipeline, revogue a senha com --reset a partir de um terminal.');
        }
        console.log('');
        console.log('🔑 Senha gerada (anote agora — não será exibida novamente):');
        console.log(`   ${senha}`);
        console.log('');
        console.log('   Guarde num gerenciador de senhas e limpe o histórico do terminal.');
    } else {
        console.log('🔑 Senha definida a partir de ADMIN_SENHA (não exibida).');
        console.log('   Apague ADMIN_SENHA do ambiente/painel agora que a conta existe.');
    }

    console.log('👉 Login em /html/login.html — o perfil admin cai no dashboard unificado.');
    // O perfil admin não entra no 2FA obrigatório (só diretor e secretaria, em
    // src/controllers/UserController.js). É a conta mais poderosa do sistema
    // protegida só por senha até alguém ligar o segundo fator manualmente.
    console.log('🔐 Ative o 2FA nesta conta logo após o primeiro login — admin não exige segundo fator por padrão.');
    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('❌ Falha ao provisionar admin:', err.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
