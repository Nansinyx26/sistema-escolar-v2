/**
 * Remove perfis de equipe que ficaram órfãos depois que a conta de login foi
 * excluída pela tela de administração.
 *
 * Até a correção em UserController.delete, apagar um usuário removia apenas o
 * documento de `usuarios`: o perfil em `professores` / `diretores` /
 * `secretarias` continuava lá. É por isso que contas já excluídas seguem
 * aparecendo no card "Professores da Escola" — aquela lista é montada direto
 * dessas coleções, não de `usuarios`. Este script limpa o que ficou para trás;
 * contas excluídas de agora em diante já saem inteiras.
 *
 * O QUE CONTA COMO ÓRFÃO: perfil com `idUsuario` preenchido apontando para um
 * `Usuario` que não existe mais. Perfil SEM `idUsuario` é pré-cadastro feito
 * pela direção (professor que ainda não fez o primeiro acesso) e NUNCA é
 * tocado — apagá-lo destruiria trabalho legítimo.
 *
 * Uso (a partir de backend/):
 *   node scripts/limpar-perfis-orfaos.js                  # só lista órfãos (dry-run)
 *   node scripts/limpar-perfis-orfaos.js --apply          # apaga os órfãos
 *
 *   node scripts/limpar-perfis-orfaos.js --buscar=adrian  # DIAGNÓSTICO: onde essa
 *       pessoa está no banco e por que ainda aparece na lista (somente leitura)
 *   node scripts/limpar-perfis-orfaos.js --buscar=adrian --apply   # apaga o perfil
 *       encontrado mesmo sem idUsuario (o caso que a varredura de órfãos preserva)
 *
 * No PowerShell é igual. Faça backup antes de rodar com --apply.
 */
require('dotenv').config();

const mongoose = require('mongoose');

const APLICAR = process.argv.includes('--apply');
const BUSCA = (process.argv.find(a => a.startsWith('--buscar=')) || '').split('=').slice(1).join('=').trim();

const COLECOES = [
    { rotulo: 'professor', modelo: '../src/models/Professor' },
    { rotulo: 'diretor', modelo: '../src/models/Diretor' },
    { rotulo: 'secretaria', modelo: '../src/models/Secretaria' }
];

/**
 * Varre as coleções de perfil usando a conexão mongoose já aberta.
 * Separado de main() para poder ser testado sem subir o script inteiro.
 *
 * @param {Object} opcoes
 * @param {boolean} opcoes.aplicar apaga de fato (false = apenas relatório)
 * @param {Function} [opcoes.log] destino das mensagens (default console.log)
 * @returns {Promise<{orfaos:number, preCadastros:number, removidos:number}>}
 */
async function limparPerfisOrfaos({ aplicar = false, log = console.log } = {}) {
    const Usuario = require('../src/models/Usuario');
    const contas = await Usuario.find({}).select('_id').lean();
    const idsDeConta = new Set(contas.map(u => String(u._id)));

    log(`Contas de login existentes: ${idsDeConta.size}`);
    log(aplicar ? 'Modo: APLICAR (vai apagar)\n' : 'Modo: dry-run (nada será apagado)\n');

    let totalOrfaos = 0;
    let totalPreCadastros = 0;
    let totalRemovidos = 0;

    for (const { rotulo, modelo } of COLECOES) {
        const Modelo = require(modelo);
        const perfis = await Modelo.find({}).select('_id nome email idUsuario').lean();

        const orfaos = [];
        let preCadastros = 0;

        for (const p of perfis) {
            const vinculo = p.idUsuario ? String(p.idUsuario) : '';
            if (!vinculo) { preCadastros++; continue; }  // pré-cadastro: preservado
            if (idsDeConta.has(vinculo)) continue;        // conta viva
            orfaos.push(p);
        }

        totalOrfaos += orfaos.length;
        totalPreCadastros += preCadastros;

        log(`-- ${rotulo} (${perfis.length} perfis, ${preCadastros} pré-cadastro(s) preservado(s))`);
        if (orfaos.length === 0) {
            log('   nenhum órfão\n');
            continue;
        }
        orfaos.forEach(p => log(`   . ${p.nome || '(sem nome)'} <${p.email || 'sem e-mail'}>  idUsuario=${p.idUsuario}`));

        if (aplicar) {
            const r = await Modelo.deleteMany({ _id: { $in: orfaos.map(p => p._id) } });
            totalRemovidos += r.deletedCount;
            log(`   -> ${r.deletedCount} removido(s)\n`);
        } else {
            log('   -> seriam removidos (rode com --apply)\n');
        }
    }

    log('-'.repeat(50));
    log(`Órfãos encontrados: ${totalOrfaos}`);
    log(`Pré-cadastros preservados: ${totalPreCadastros}`);
    if (totalOrfaos > 0 && !aplicar) {
        log('\nNada foi alterado. Para apagar: node scripts/limpar-perfis-orfaos.js --apply');
    }

    return { orfaos: totalOrfaos, preCadastros: totalPreCadastros, removidos: totalRemovidos };
}

/**
 * Modo diagnóstico: procura a pessoa em TODAS as coleções e explica o estado de
 * cada documento encontrado.
 *
 * Existe porque a varredura de órfãos preserva, de propósito, perfil sem
 * `idUsuario` — tratando como pré-cadastro da direção. Só que um cadastro
 * ANTIGO, feito antes de o vínculo existir, também está sem `idUsuario`: para o
 * script ele é indistinguível de um pré-cadastro, e continua aparecendo na
 * lista da equipe mesmo depois da conta ter sido apagada. Aqui o operador vê o
 * documento e decide.
 *
 * @param {string} termo trecho do nome ou e-mail (sem distinção de maiúsculas)
 * @param {Object} opcoes
 * @param {boolean} opcoes.aplicar apaga os perfis encontrados
 * @param {Function} [opcoes.log]
 * @returns {Promise<{perfis:number, contas:number, removidos:number}>}
 */
async function buscarPessoa(termo, { aplicar = false, log = console.log } = {}) {
    const Usuario = require('../src/models/Usuario');
    // Comparação em memória, sem regex: as coleções de equipe têm dezenas de
    // documentos, e assim um e-mail com "." ou "+" é buscado como texto literal.
    const termoNorm = String(termo).toLowerCase();
    const bate = (d) => `${d.nome || ''} ${d.email || ''}`.toLowerCase().includes(termoNorm);

    log(`
Buscando por "${termo}"
${'='.repeat(50)}`);

    const contas = (await Usuario.find({}).select('_id nome email perfil ativo').lean()).filter(bate);
    log(`
CONTA DE LOGIN (usuarios): ${contas.length} encontrada(s)`);
    contas.forEach(u => log(`   . ${u.nome} <${u.email}>  perfil=${u.perfil} ativo=${u.ativo} _id=${u._id}`));
    if (contas.length === 0) log('   (nenhuma — o login já foi apagado)');

    const idsDeConta = new Set((await Usuario.find({}).select('_id').lean()).map(u => String(u._id)));
    let totalPerfis = 0;
    let totalRemovidos = 0;

    for (const { rotulo, modelo } of COLECOES) {
        const Modelo = require(modelo);
        const achados = (await Modelo.find({}).select('_id nome email idUsuario escola').lean()).filter(bate);
        if (achados.length === 0) continue;

        totalPerfis += achados.length;
        log(`
PERFIL EM ${rotulo.toUpperCase()}: ${achados.length} documento(s)`);
        for (const p of achados) {
            const vinculo = p.idUsuario ? String(p.idUsuario) : '';
            const estado = !vinculo
                ? 'SEM idUsuario — a varredura de órfãos NÃO apaga este'
                : (idsDeConta.has(vinculo) ? 'conta de login existe (pessoa ativa)' : 'órfão: conta apagada');
            log(`   . ${p.nome} <${p.email || 'sem e-mail'}>  _id=${p._id}`);
            log(`     escola=${p.escola || '—'}  idUsuario=${p.idUsuario || '(vazio)'}`);
            log(`     -> ${estado}`);
        }

        if (aplicar) {
            const comConta = achados.filter(p => p.idUsuario && idsDeConta.has(String(p.idUsuario)));
            const removiveis = achados.filter(p => !comConta.includes(p));
            comConta.forEach(p => log(`   !! ${p.nome} tem conta de login ativa — preservado. Apague pela tela de usuários.`));
            if (removiveis.length) {
                const r = await Modelo.deleteMany({ _id: { $in: removiveis.map(p => p._id) } });
                totalRemovidos += r.deletedCount;
                log(`   -> ${r.deletedCount} perfil(is) removido(s)`);
            }
        }
    }

    if (totalPerfis === 0) {
        log(`
Nenhum perfil em professores/diretores/secretarias.`);
        log('Se a pessoa ainda aparece na tela, o navegador está servindo cache: recarregue com Ctrl+Shift+R.');
    } else if (!aplicar) {
        log(`
Nada foi alterado. Para apagar os perfis acima: --buscar="${termo}" --apply`);
    }

    return { perfis: totalPerfis, contas: contas.length, removidos: totalRemovidos };
}

async function main() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGODB_URI não definida. Preencha backend/.env (veja backend/.env.example).');
        process.exit(1);
    }

    await mongoose.connect(uri, {
        dbName: process.env.MONGODB_DB_NAME || undefined,
        serverSelectionTimeoutMS: 10000
    });
    console.log('Conectado ao MongoDB\n');

    if (BUSCA) {
        await buscarPessoa(BUSCA, { aplicar: APLICAR });
    } else {
        await limparPerfisOrfaos({ aplicar: APLICAR });
    }

    await mongoose.disconnect();
}

module.exports = { limparPerfisOrfaos, buscarPessoa };

// Só conecta e roda quando chamado direto pelo terminal — importar num teste
// não deve abrir conexão nem derrubar o processo.
if (require.main === module) {
    main().catch(async (e) => {
        console.error('Falha:', e.message);
        try { await mongoose.disconnect(); } catch (_) { }
        process.exit(1);
    });
}
