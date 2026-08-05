
// Native fetch is available in Node > 18
async function debugData() {
    const baseUrl = 'http://localhost:3001/api';

    try {
        console.log('Fetching data...');
        const [notasRes, alunosRes, turmasRes] = await Promise.all([
            fetch(`${baseUrl}/notas`),
            fetch(`${baseUrl}/alunos`),
            fetch(`${baseUrl}/turmas`)
        ]);

        const notas = (await notasRes.json()).data;
        const alunos = (await alunosRes.json()).data;
        const turmas = (await turmasRes.json()).data;

        console.log(`Total Notas: ${notas.length}`);
        console.log(`Total Alunos: ${alunos.length}`);
        console.log(`Total Turmas: ${turmas.length}`);

        // Check map integrity
        const alunosMap = {};
        alunos.forEach(a => alunosMap[a._id] = a);

        const turmasMap = {};
        turmas.forEach(t => turmasMap[t.id || t._id] = t); // Check both, DB usually has _id but sometimes id is aliased

        let droppedCount = 0;
        let missingTurmaCount = 0;
        let missingMateriaCount = 0;

        notas.forEach((n, index) => {
            const alunoId = n.aluno || n.alunoId;
            const aluno = alunosMap[alunoId];

            if (!aluno) {
                if (droppedCount < 5) console.log(`[DROP] Nota ${n._id} has invalid alunoId: ${alunoId}`);
                droppedCount++;
            } else {
                // Check Turma
                const turmaId = n.turma;
                const turma = turmasMap[turmaId] || turmas.find(t => t.id === turmaId || t._id === turmaId);

                if (!turma) {
                    if (missingTurmaCount < 5) console.log(`[?] Missing Turma for Nota ${n._id}. Value: ${turmaId}`);
                    missingTurmaCount++;
                } else {
                    // console.log(`[OK] Turma found: ${turma.id} / ${turma._id}`);
                }

                if (!n.materia) {
                    if (missingMateriaCount < 5) console.log(`[?] Nota ${n._id} has no materia field.`);
                    missingMateriaCount++;
                }
            }
        });

        console.log('--- Summary ---');
        console.log(`Dropped (Missing Aluno): ${droppedCount}`);
        console.log(`Missing Turma Lookup: ${missingTurmaCount}`);
        console.log(`Missing Materia Field: ${missingMateriaCount}`);

    } catch (e) {
        console.error(e);
    }
}

debugData();
