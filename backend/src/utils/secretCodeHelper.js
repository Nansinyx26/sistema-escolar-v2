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

/**
 * Checks all students in the database and generates a unique secret code 
 * for any student that doesn't already have one.
 */
async function initializeSecretCodes() {
    try {
        console.log('🔑 [SECRET-CODES] Checking students with missing or invalid secret codes...');
        const students = await Aluno.find({
            $or: [
                { codigoSecreto: { $exists: false } },
                { codigoSecreto: null },
                { codigoSecreto: '' },
                { codigoSecreto: 'N/A' },
                { codigoSecreto: 'n/a' }
            ]
        });

        if (students.length === 0) {
            console.log('✅ [SECRET-CODES] All students already have secret codes.');
            return;
        }

        console.log(`🔑 [SECRET-CODES] Found ${students.length} students without valid secret codes. Generating...`);
        for (const student of students) {
            // Setting it to null will trigger the pre-save hook to generate a unique code
            student.codigoSecreto = undefined;
            await student.save();
            console.log(`   └─ Student: ${student.nome} -> Secret code initialized`);

            // SEGURANÇA: o broadcast antigo entregava o código secreto a TODOS
            // os sockets conectados. O evento agora só avisa que houve mudança
            // (restrito à escola do aluno); o código sai apenas pela rota
            // autenticada /api/alunos/codigos-secretos.
            emitirParaEscola(student.escolaId, 'student:code_updated', {
                id: student._id || student.id,
                nome: `${student.nome} ${student.sobrenome || ''}`.trim()
            });
        }
        console.log('✅ [SECRET-CODES] Secret codes initialization complete!');
    } catch (err) {
        console.error('❌ [SECRET-CODES] Error during secret codes initialization:', err.message);
    }
}

module.exports = {
    generateRandomCode,
    generateUniqueSecretCode,
    initializeSecretCodes
};
