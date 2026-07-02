const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const ATlas_URI = 'mongodb+srv://nandev:iQcJX5e1iObrExqg@sistemaescolar.s98lpdu.mongodb.net/test?appName=SistemaEscolar';

async function main() {
    console.log('🔌 Conectando ao MongoDB Atlas...');
    const client = new MongoClient(ATlas_URI);
    try {
        await client.connect();
        console.log('✅ Conectado com sucesso!');
        
        const db = client.db('test');
        
        // Listar coleções existentes no banco test
        const collections = await db.listCollections().toArray();
        const existingNames = collections.map(c => c.name);
        console.log('\nColeções existentes no banco Atlas:');
        console.log(existingNames);
        
        // Carregar coleções mapeadas do collections.json
        const expectedFilePath = path.join(__dirname, 'collections.json');
        if (!fs.existsSync(expectedFilePath)) {
            console.error('❌ Erro: collections.json não encontrado. Rode o script list_models_scratch.js primeiro.');
            process.exit(1);
        }
        
        const expectedData = JSON.parse(fs.readFileSync(expectedFilePath, 'utf8'));
        const expectedNames = [...new Set(expectedData.map(c => c.collection))];
        
        // Adicionar GridFS collections que sabemos ser necessárias se houver upload
        if (!expectedNames.includes('uploads.files')) expectedNames.push('uploads.files');
        if (!expectedNames.includes('uploads.chunks')) expectedNames.push('uploads.chunks');
        
        expectedNames.sort();
        existingNames.sort();
        
        const missing = [];
        const present = [];
        
        for (const modelCol of expectedNames) {
            if (existingNames.includes(modelCol)) {
                // Obter contagem de documentos
                const count = await db.collection(modelCol).countDocuments();
                present.push({ name: modelCol, count });
            } else {
                missing.push(modelCol);
            }
        }
        
        const report = {
            dbInUse: 'test',
            expectedTotal: expectedNames.length,
            existingTotalInAtlas: existingNames.length,
            presentCollections: present,
            missingCollections: missing,
            extraCollections: existingNames.filter(c => !expectedNames.includes(c))
        };
        
        fs.writeFileSync(
            path.join(__dirname, 'comparison_report.json'),
            JSON.stringify(report, null, 2),
            'utf8'
        );
        console.log('\n📊 Comparação de coleções salva em comparison_report.json!');
        console.log('\nFaltando no Atlas:', missing);
        
    } catch (err) {
        console.error('❌ Erro ao comparar coleções:', err);
    } finally {
        await client.close();
    }
}

main();
