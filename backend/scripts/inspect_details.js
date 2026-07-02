
async function inspectDetails() {
    const baseUrl = 'http://localhost:3001/api';

    try {
        const [notasRes, turmasRes] = await Promise.all([
            fetch(`${baseUrl}/notas`),
            fetch(`${baseUrl}/turmas`)
        ]);

        const notas = (await notasRes.json()).data;
        const turmas = (await turmasRes.json()).data;

        // Find the 2 surviving notes (where aluno lookup likely works, but we can just print any note to see format)
        // Actually, just print the first 3 notes to see their structure
        console.log('--- Sample Notes ---');
        console.log(JSON.stringify(notas.slice(0, 3), null, 2));

        console.log('--- Sample Turmas ---');
        console.log(JSON.stringify(turmas.slice(0, 3), null, 2));

    } catch (e) {
        console.error(e);
    }
}

inspectDetails();
