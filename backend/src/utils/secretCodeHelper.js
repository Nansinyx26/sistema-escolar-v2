const Aluno = require('../models/Aluno');
const crypto = require('crypto');
const { emitirParaEscola } = require('./realtime');

// Alfabeto sem caracteres ambíguos (0/O, 1/I) — o código é ditado por telefone
// e transcrito à mão pelos responsáveis.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TAMANHO_CODIGO = 10;

/**
 * Gera um código secreto aleatório.
 *
 * SEGURANÇA: usa crypto.randomInt (CSPRNG), não Math.random. O PRNG do V8
 * (xorshift128+) tem estado recuperável a partir de poucas saídas — e todo
 * responsável recebe legitimamente um código, ou seja, um atacante tinha
 * amostras de sobra para prever os códigos dos outros alunos.
 *
 * 10 caracteres num alfabeto de 32 = 2^50 combinações (antes: 36^6 ≈ 2^31).
 */
function generateRandomCode(tamanho = TAMANHO_CODIGO) {
    let code = '';
    for (let i = 0; i < tamanho; i++) {
        code += ALFABETO.charAt(crypto.randomInt(0, ALFABETO.length));
    }
    return code;
}

/**
 * Generates a unique secret code that does not exist in the database yet.
 */
async function generateUniqueSecretCode() {
    let code = '';
    let exists = true;
    let attempts = 0;

    while (exists && attempts < 100) {
        code = generateRandomCode();
        const existing = await Aluno.findOne({ codigoSecreto: code });
        if (!existing) {
            exists = false;
        }
        attempts++;
    }

    // Colisão em 2^50 é praticamente impossível; se acontecer, alonga o código
    // em vez de aceitar uma repetição silenciosa.
    if (exists) {
        console.warn(`⚠️ [SECRET-CODES] Colisões após ${attempts} tentativas — gerando código estendido.`);
        code = generateRandomCode(TAMANHO_CODIGO + 4);
    }

    return code;
}

/** Filtro dos alunos que ainda não têm um código secreto utilizável. */
const FILTRO_SEM_CODIGO = {
    $or: [
        { codigoSecreto: { $exists: false } },
        { codigoSecreto: null },
        { codigoSecreto: '' },
        { codigoSecreto: 'N/A' },
        { codigoSecreto: 'n/a' }
    ]
};

/** Divide uma lista em blocos de tamanho fixo. */
function emLotes(lista, tamanho) {
    const lotes = [];
    for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho));
    return lotes;
}

const LOTE_MAXIMO = 500;

/**
 * Atribui um código secreto a vários alunos de uma vez.
 *
 * Substitui o laço `findById → codigoSecreto = undefined → save()` que rodava
 * por aluno. Aquele caminho custava 3 idas ao banco por aluno e, pior, corria
 * dentro de um único try: bastava UM documento legado reprovar na validação do
 * schema (`nome` obrigatório, enum antigo em `guardaLegal`...) para o laço
 * abortar e todos os alunos seguintes ficarem sem código para sempre — que é o
 * que deixava a tela da direção presa em "Gerando..." indefinidamente.
 *
 * Aqui o custo é de 3 consultas para QUALQUER quantidade de alunos, o
 * `bulkWrite` grava só o campo do código (sem revalidar o documento inteiro) e
 * `ordered: false` garante que a falha de um aluno não impeça os demais.
 *
 * @param {Array} ids  _id dos alunos a receber código
 * @returns {Promise<Map<string, string>>} mapa id → código efetivamente gravado
 */
async function assignSecretCodes(ids) {
    const atribuidos = new Map();
    if (!Array.isArray(ids) || ids.length === 0) return atribuidos;

    for (const lote of emLotes(ids, LOTE_MAXIMO)) {
        // Gera localmente; o Set já elimina colisões dentro do próprio lote.
        const gerados = new Set();
        while (gerados.size < lote.length) gerados.add(generateRandomCode());
        let candidatos = [...gerados];

        // Uma única checagem de colisão contra o banco (em vez de uma por aluno).
        // Colisão em 2^50 é praticamente impossível; se ocorrer, o código do
        // aluno afetado é regerado estendido em vez de repetir silenciosamente.
        for (let tentativa = 0; tentativa < 5; tentativa++) {
            const emUso = await Aluno.find({ codigoSecreto: { $in: candidatos } })
                .select('codigoSecreto')
                .lean();
            if (emUso.length === 0) break;
            const usados = new Set(emUso.map(d => d.codigoSecreto));
            candidatos = candidatos.map(c => (usados.has(c) ? generateRandomCode(TAMANHO_CODIGO + 4) : c));
        }

        const ops = lote.map((id, i) => ({
            updateOne: {
                filter: { _id: id },
                update: { $set: { codigoSecreto: candidatos[i] } }
            }
        }));

        try {
            await Aluno.bulkWrite(ops, { ordered: false });
        } catch (err) {
            // Com ordered:false as demais operações do lote seguem valendo; o
            // que realmente ficou gravado é confirmado na consulta abaixo.
            console.error('❌ [SECRET-CODES] Falha parcial ao gravar códigos:', err.message);
        }

        // Confirma no banco (1 consulta) em vez de assumir que tudo passou.
        const gravados = await Aluno.find({ _id: { $in: lote } })
            .select('codigoSecreto')
            .lean();
        gravados.forEach(d => {
            if (d.codigoSecreto) atribuidos.set(String(d._id), d.codigoSecreto);
        });
    }

    return atribuidos;
}

/**
 * Checks all students in the database and generates a unique secret code
 * for any student that doesn't already have one.
 */
async function initializeSecretCodes() {
    try {
        console.log('🔑 [SECRET-CODES] Checking students with missing or invalid secret codes...');
        const students = await Aluno.find(FILTRO_SEM_CODIGO)
            .select('nome sobrenome escolaId id')
            .lean();

        if (students.length === 0) {
            console.log('✅ [SECRET-CODES] All students already have secret codes.');
            return;
        }

        console.log(`🔑 [SECRET-CODES] Found ${students.length} students without valid secret codes. Generating...`);
        const atribuidos = await assignSecretCodes(students.map(s => s._id));

        for (const student of students) {
            if (!atribuidos.has(String(student._id))) {
                console.warn(`   └─ ⚠️ ${student.nome}: código NÃO gravado — verificar o documento.`);
                continue;
            }

            // SEGURANÇA: o broadcast antigo entregava o código secreto a TODOS
            // os sockets conectados. O evento agora só avisa que houve mudança
            // (restrito à escola do aluno); o código sai apenas pela rota
            // autenticada /api/alunos/codigos-secretos.
            emitirParaEscola(student.escolaId, 'student:code_updated', {
                id: student._id || student.id,
                nome: `${student.nome} ${student.sobrenome || ''}`.trim()
            });
        }
        console.log(`✅ [SECRET-CODES] ${atribuidos.size}/${students.length} código(s) inicializado(s).`);
    } catch (err) {
        console.error('❌ [SECRET-CODES] Error during secret codes initialization:', err.message);
    }
}

module.exports = {
    generateRandomCode,
    generateUniqueSecretCode,
    assignSecretCodes,
    initializeSecretCodes,
    FILTRO_SEM_CODIGO
};
