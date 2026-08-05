require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

async function listAllCollections() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();

        console.log('--- DATABASE STATUS ---');
        for (const col of collections) {
            const count = await db.collection(col.name).countDocuments();
            console.log(`- ${col.name}: ${count} documents`);
        }
        console.log('-----------------------');

        await mongoose.disconnect();
    } catch (error) {
        console.error('Error:', error.message);
    }
}

listAllCollections();
