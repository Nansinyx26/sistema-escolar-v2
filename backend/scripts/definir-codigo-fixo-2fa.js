/**
 * definir-codigo-fixo-2fa.js
 * ============================================================================
 * Define o código fixo de 2FA de uma conta, guardando apenas o HASH no banco.
 *
 * Substitui `update_secretaria_2fa.js`, que tinha DOIS problemas graves:
 *
 *   1. O código estava ESCRITO no arquivo, versionado em repositório público.
 *      Um segundo fator de conhecimento público não é segundo fator. O valor
 *      antigo segue no histórico do git e deve ser considerado queimado —
 *      rotacione, não reaproveite.
 *   2. Ele gravava o valor em TEXTO PURO no banco — qualquer dump entregava a
 *      credencial pronta.
 *
 * Aqui o código nunca aparece no arquivo. Ele é gerado aleatoriamente (ou vem
 * de uma variável de ambiente, para quem precisa escolher) e é exibido UMA vez
 * na saída do comando. No banco vai só o hash scrypt.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * USO
 * ─────────────────────────────────────────────────────────────────────────
 *   # gera um código aleatório de 6 dígitos e mostra na tela
 *   node scripts/definir-codigo-fixo-2fa.js diretor@escola.com
 *
 *   # escolhe o código (via ambiente — nunca como argumento, que fica no
 *   # histórico do shell)
 *   CODIGO_FIXO=123456 node scripts/definir-codigo-fixo-2fa.js diretor@escola.com
 *
 *   # remove o código fixo da conta
 *   node scripts/definir-codigo-fixo-2fa.js diretor@escola.com --remover
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ANTES DE USAR, CONSIDERE A ALTERNATIVA
 * ─────────────────────────────────────────────────────────────────────────
 * Um código FIXO é reutilizável: quem o vir uma vez entra sempre. Para dar
 * acesso sem depender de e-mail, os códigos de BACKUP são melhores — são de uso
 * único e se gerenciam pela interface:
 *
 *     Painel admin → Usuários → botão de chave
 *
 * Use este script apenas quando o código reutilizável for mesmo o que você quer.
 * ============================================================================
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const crypto = require('crypto');
const { hashSegredo } = require('../src/utils/codigosBackup');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'test';

const email = (process.argv[2] || '').trim().toLowerCase();
const remover = process.argv.includes('--remover');

if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI não definida no .env');
    process.exit(1);
}
if (!email || !email.includes('@')) {
    console.error('❌ Informe o e-mail da conta.');
    console.error('   node scripts/definir-codigo-fixo-2fa.js diretor@escola.com [--remover]');
    process.exit(1);
}

/** 6 dígitos, sorteados sem viés. */
function gerarCodigo() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function run() {
    await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });
    const Usuario = require('../src/models/Usuario');

    const usuario = await Usuario.findOne({ email }).select('email nome perfil ativo').lean();
    if (!usuario) {
        console.error(`❌ Nenhuma conta com o e-mail informado.`);
        process.exit(1);
    }

    if (remover) {
        await Usuario.updateOne({ _id: usuario._id }, { $unset: { twoFactorFixedCode: '' } });
        console.log(`✅ Código fixo REMOVIDO de ${usuario.nome} (${usuario.perfil}).`);
        console.log('   A conta volta ao 2FA por e-mail (ou aos códigos de backup).');
        return;
    }

    // Código escolhido pelo operador vem do AMBIENTE, nunca de argv: argumento
    // de linha de comando fica no histórico do shell e na lista de processos.
    const escolhido = (process.env.CODIGO_FIXO || '').trim();
    if (escolhido && !/^\d{6}$/.test(escolhido)) {
        console.error('❌ CODIGO_FIXO deve ter exatamente 6 dígitos.');
        process.exit(1);
    }

    const codigo = escolhido || gerarCodigo();
    const hash = await hashSegredo(codigo);

    await Usuario.updateOne({ _id: usuario._id }, {
        $set: {
            twoFactorFixedCode: hash,
            twoFactorEnabled: true,
            emailVerificado: true,
            twoFactorPendingToken: null,
            twoFactorPendingExpiry: null,
        },
    });

    console.log('');
    console.log('  ┌───────────────────────────────────────────────┐');
    console.log(`  │  Conta:  ${usuario.nome} (${usuario.perfil})`);
    console.log('  │');
    console.log(`  │  CÓDIGO FIXO:  ${codigo}`);
    console.log('  │');
    console.log('  └───────────────────────────────────────────────┘');
    console.log('');
    console.log('  Este código aparece UMA ÚNICA VEZ — no banco só existe o hash.');
    console.log('  Entregue por um canal SEPARADO da senha (pessoalmente ou por');
    console.log('  telefone). Nunca no mesmo e-mail em que a senha foi enviada.');
    console.log('');
    console.log('  Ele é REUTILIZÁVEL: quem o vir uma vez entra sempre. Se puder,');
    console.log('  prefira os códigos de backup (uso único), no painel admin.');
    console.log('');
}

run()
    .catch((e) => { console.error('❌ Falhou:', e.message); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
