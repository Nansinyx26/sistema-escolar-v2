/**
 * SCRIPT DE DIAGNÓSTICO DO BANCO DE DADOS
 * Analisa o estado real do MongoDB e gera relatório de segurança
 * 
 * USO: node scripts/diagnostico-db.js
 * (coloque MONGODB_URI no .env antes de rodar)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('\n❌ ERRO: MONGODB_URI não encontrada!');
    console.error('   Crie o arquivo backend/.env com a linha:');
    console.error('   MONGODB_URI=mongodb+srv://<usuario>:<senha>@cluster0.mongodb.net/escola_db\n');
    process.exit(1);
}

async function diagnosticar() {
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║     DIAGNÓSTICO DO BANCO DE DADOS — SISTEMA ESCOLAR  ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

    try {
        const maskedUri = MONGODB_URI.replace(/:([^@]+)@/, ':****@');
        console.log(`🔌 Conectando: ${maskedUri}`);
        await mongoose.connect(MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME || 'escola_db' });
        console.log('✅ Conexão estabelecida!\n');

        const db = mongoose.connection.db;

        // ──────────────────────────────────────────────
        // 1. COLEÇÕES EXISTENTES
        // ──────────────────────────────────────────────
        const collections = await db.listCollections().toArray();
        console.log('📂 COLEÇÕES NO BANCO:');
        for (const col of collections) {
            const count = await db.collection(col.name).countDocuments();
            console.log(`   - ${col.name.padEnd(30)} ${count} documentos`);
        }

        // ──────────────────────────────────────────────
        // 2. ANÁLISE DE USUÁRIOS
        // ──────────────────────────────────────────────
        console.log('\n👤 ANÁLISE DE USUÁRIOS:');
        const usuarios = await db.collection('usuarios').find({}).toArray();
        const totalUsuarios = usuarios.length;
        const ativos = usuarios.filter(u => u.ativo !== false).length;
        const inativos = usuarios.filter(u => u.ativo === false).length;
        const comSenhaHash = usuarios.filter(u => u.senha && u.senha.startsWith('$2')).length;
        const comSenhaPlano = usuarios.filter(u => u.senha && !u.senha.startsWith('$2') && u.senha !== 'DELETADO_POR_SEGURANCA').length;
        const semSenha = usuarios.filter(u => !u.senha || u.senha === 'DELETADO_POR_SEGURANCA').length;
        const porPerfil = {};
        usuarios.forEach(u => { porPerfil[u.perfil || 'sem_perfil'] = (porPerfil[u.perfil || 'sem_perfil'] || 0) + 1; });

        console.log(`   Total de usuários:      ${totalUsuarios}`);
        console.log(`   ├─ Ativos:              ${ativos}`);
        console.log(`   ├─ Inativos:            ${inativos}`);
        console.log(`   ├─ Senha com bcrypt:    ${comSenhaHash}  ✅`);
        console.log(`   ├─ Senha em texto plano: ${comSenhaPlano} ${comSenhaPlano > 0 ? '❌ CRÍTICO' : '✅'}`);
        console.log(`   └─ Sem senha/anonimizados: ${semSenha}`);
        console.log('   Perfis:');
        Object.entries(porPerfil).forEach(([perfil, qtd]) => {
            console.log(`      - ${perfil}: ${qtd}`);
        });

        // Verifica emails de usuários com senha em plano
        if (comSenhaPlano > 0) {
            const plainUsers = usuarios.filter(u => u.senha && !u.senha.startsWith('$2') && u.senha !== 'DELETADO_POR_SEGURANCA');
            console.log('\n   ⚠️  USUÁRIOS COM SENHA EM TEXTO PLANO:');
            plainUsers.forEach(u => {
                console.log(`      - ${u.email} (perfil: ${u.perfil}, senha: "${u.senha}")`);
            });
        }

        // Últimos logins
        const comUltimoLogin = usuarios.filter(u => u.ultimoLogin).sort((a,b) => new Date(b.ultimoLogin) - new Date(a.ultimoLogin));
        if (comUltimoLogin.length > 0) {
            console.log('\n   📅 ÚLTIMOS 5 LOGINS:');
            comUltimoLogin.slice(0, 5).forEach(u => {
                const dt = new Date(u.ultimoLogin).toLocaleString('pt-BR');
                console.log(`      - ${u.email} em ${dt}`);
            });
        }

        // ──────────────────────────────────────────────
        // 3. ANÁLISE DE ALUNOS
        // ──────────────────────────────────────────────
        console.log('\n🎒 ANÁLISE DE ALUNOS:');
        const alunos = await db.collection('alunos').find({}).toArray();
        const totalAlunos = alunos.length;
        const alunosAtivos = alunos.filter(a => a.ativo !== false).length;
        const comFotoBase64 = alunos.filter(a => a.foto && a.foto.startsWith('data:')).length;
        const comFotoGridFS = alunos.filter(a => a.foto && !a.foto.startsWith('data:') && a.foto.length < 50).length;
        const semFoto = alunos.filter(a => !a.foto).length;
        const pcd = alunos.filter(a => a.pcd === true).length;
        const turmasUnicas = [...new Set(alunos.map(a => a.turma || a.turmaId).filter(Boolean))];

        console.log(`   Total de alunos:        ${totalAlunos}`);
        console.log(`   ├─ Ativos:              ${alunosAtivos}`);
        console.log(`   ├─ Com foto base64:     ${comFotoBase64} ${comFotoBase64 > 0 ? '⚠️  (dado sensível no MongoDB!)' : ''}`);
        console.log(`   ├─ Com foto GridFS:     ${comFotoGridFS}`);
        console.log(`   ├─ Sem foto:            ${semFoto}`);
        console.log(`   ├─ PCD:                 ${pcd}`);
        console.log(`   └─ Turmas cadastradas:  ${turmasUnicas.length} (${turmasUnicas.sort().join(', ')})`);

        // Tamanho médio dos documentos com base64
        if (comFotoBase64 > 0) {
            const alunosComFoto = alunos.filter(a => a.foto && a.foto.startsWith('data:'));
            const tamMedio = alunosComFoto.reduce((acc, a) => acc + a.foto.length, 0) / alunosComFoto.length;
            console.log(`   ⚠️  Tamanho médio da foto base64: ~${(tamMedio / 1024).toFixed(1)} KB por documento`);
        }

        // ──────────────────────────────────────────────
        // 4. PROFESSORES
        // ──────────────────────────────────────────────
        console.log('\n📚 ANÁLISE DE PROFESSORES:');
        const professores = await db.collection('professores').find({}).toArray();
        const profAtivos = professores.filter(p => p.ativo !== false).length;
        const profComCpf = professores.filter(p => p.cpf).length;
        console.log(`   Total de professores:   ${professores.length}`);
        console.log(`   ├─ Ativos:              ${profAtivos}`);
        console.log(`   └─ Com CPF cadastrado:  ${profComCpf}`);

        // ──────────────────────────────────────────────
        // 5. AUDITORIA
        // ──────────────────────────────────────────────
        console.log('\n📋 LOGS DE AUDITORIA:');
        const auditLogs = await db.collection('audit_logs').find({}).toArray();
        const acoesPorTipo = {};
        auditLogs.forEach(l => { acoesPorTipo[l.acao] = (acoesPorTipo[l.acao] || 0) + 1; });
        const loginsFalhados = auditLogs.filter(l => l.acao === 'LOGIN_FAILED').length;
        console.log(`   Total de logs:          ${auditLogs.length}`);
        console.log(`   Logins falhados:        ${loginsFalhados} ${loginsFalhados > 100 ? '⚠️  Possível ataque de força bruta!' : ''}`);
        console.log('   Ações por tipo:');
        Object.entries(acoesPorTipo).sort((a,b) => b[1]-a[1]).forEach(([acao, qtd]) => {
            console.log(`      - ${acao.padEnd(35)} ${qtd}x`);
        });

        // ──────────────────────────────────────────────
        // 6. SECURITY CONFIG
        // ──────────────────────────────────────────────
        console.log('\n🔐 CONFIGURAÇÍO DE SEGURANÇA:');
        const secConfig = await db.collection('security_configs').findOne({});
        if (secConfig) {
            const ultimaRotacao = secConfig.dataUltimaRotacao ? new Date(secConfig.dataUltimaRotacao).toLocaleString('pt-BR') : 'Nunca';
            const diasSemRotacao = secConfig.dataUltimaRotacao
                ? Math.floor((Date.now() - new Date(secConfig.dataUltimaRotacao)) / 86400000)
                : 999;
            console.log(`   Código secreto:         ${secConfig.codigoSecretoEscola || 'N/A'}`);
            console.log(`   Última rotação:         ${ultimaRotacao}`);
            console.log(`   Dias sem rotação:       ${diasSemRotacao} ${diasSemRotacao > 7 ? '⚠️  Rotacione o código!' : '✅'}`);
            console.log(`   Rotação automática:     ${secConfig.rotaçãoAutomatica ? 'Ativada ✅' : 'Desativada ⚠️'}`);
            console.log(`   Tentativas inválidas:   ${(secConfig.tentativasInvalidas || []).length}`);
        } else {
            console.log('   ⚠️  Nenhuma configuração de segurança encontrada!');
        }

        // ──────────────────────────────────────────────
        // 7. NOTAS E FALTAS
        // ──────────────────────────────────────────────
        console.log('\n📊 DADOS ACADÊMICOS:');
        const notas = await db.collection('notas').countDocuments();
        const faltas = await db.collection('faltas').countDocuments();
        const frequenciasProf = await db.collection('frequenciaprofessors').countDocuments().catch(() => 0);
        console.log(`   Notas registradas:      ${notas}`);
        console.log(`   Registros de falta:     ${faltas}`);
        console.log(`   Frequências professor:  ${frequenciasProf}`);

        // ──────────────────────────────────────────────
        // 8. ÍNDICES DO BANCO
        // ──────────────────────────────────────────────
        console.log('\n🗂️  ÍNDICES CRÍTICOS:');
        const colsParaChkIdx = ['usuarios', 'alunos', 'professores', 'audit_logs'];
        for (const colName of colsParaChkIdx) {
            try {
                const indexes = await db.collection(colName).indexes();
                console.log(`   ${colName}: ${indexes.map(i => Object.keys(i.key).join(',')).join(' | ')}`);
            } catch (e) { /* skip */ }
        }

        // ──────────────────────────────────────────────
        // 9. RESUMO FINAL
        // ──────────────────────────────────────────────
        console.log('\n╔══════════════════════════════════════════════════════╗');
        console.log('║                  RESUMO DE RISCOS                    ║');
        console.log('╚══════════════════════════════════════════════════════╝');
        const riscos = [];
        if (comSenhaPlano > 0) riscos.push(`🔴 CRÍTICO: ${comSenhaPlano} usuário(s) com senha em TEXTO PLANO`);
        if (comFotoBase64 > 0) riscos.push(`🟠 ALTO: ${comFotoBase64} aluno(s) com foto armazenada como base64 no MongoDB`);
        if (loginsFalhados > 50) riscos.push(`🟠 ALTO: ${loginsFalhados} logins falhados — possível ataque de força bruta`);
        if (secConfig && !secConfig.rotaçãoAutomatica) riscos.push('🟡 MÉDIO: Rotação automática do código secreto desativada');
        if (!secConfig) riscos.push('🟡 MÉDIO: Sem configuração de segurança no banco');
        if (auditLogs.length === 0) riscos.push('🟡 MÉDIO: Nenhum log de auditoria encontrado');

        if (riscos.length === 0) {
            console.log('✅ Nenhum risco crítico identificado nos dados do banco!');
        } else {
            riscos.forEach(r => console.log(`   ${r}`));
        }

        console.log('\n✅ Diagnóstico concluído.\n');

    } catch (error) {
        console.error(`\n❌ ERRO: ${error.message}\n`);
    } finally {
        await mongoose.disconnect();
    }
}

diagnosticar();
