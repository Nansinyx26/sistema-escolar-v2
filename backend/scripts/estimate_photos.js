const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const MONGODB_URI = process.env.MONGODB_URI;

async function estimateSpace() {
    try {
        await mongoose.connect(MONGODB_URI);
        const db = mongoose.connection.db;
        
        let totalPhotos = 0;
        let totalSize = 0;

        for (const coll of ['alunos', 'professores', 'diretores', 'usuarios']) {
            const docs = await db.collection(coll).find({ foto: { $exists: true, $ne: "", $ne: null } }).project({ foto: 1 }).toArray();
            for (const doc of docs) {
                totalPhotos++;
                totalSize += doc.foto.length; // Approximate size in bytes for base64 string
            }
        }

        if (totalPhotos > 0) {
            const avgSize = totalSize / totalPhotos;
            const maxMB = 512; // Atlas Free Tier
            const maxBytes = maxMB * 1024 * 1024;
            const estimatedMax = Math.floor(maxBytes / avgSize);
            
            console.log(`TOTAL_PHOTOS=${totalPhotos}`);
            console.log(`AVG_SIZE_KB=${(avgSize / 1024).toFixed(2)}`);
            console.log(`ESTIMATED_MAX=${estimatedMax}`);
        } else {
            console.log("No photos found.");
        }
    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
}
estimateSpace();
