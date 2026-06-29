const Aluno = require('../models/Aluno');

/**
 * Generates a random 6-character alphanumeric secret code (A-Z, 0-9).
 */
function generateRandomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
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

    // Fallback if many collisions happen - stay at 6 characters but try again or append a small random
    if (exists) {
        console.warn(`⚠️ [SECRET-CODES] High collision rate detected after ${attempts} attempts. Forcing a new random code.`);
        code = generateRandomCode(); 
    }

    console.log(`🔑 [SECRET-CODES] Generated unique code: ${code} after ${attempts} attempts.`);
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
            console.log(`   └─ Student: ${student.nome} -> Code: ${student.codigoSecreto}`);
            
            // Notify frontend in real-time about new student or code updates if socket.io is active
            if (global.io) {
                global.io.emit('student:code_updated', {
                    id: student._id || student.id,
                    nome: `${student.nome} ${student.sobrenome || ''}`.trim(),
                    codigoSecreto: student.codigoSecreto
                });
            }
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
