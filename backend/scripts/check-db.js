const { MongoClient } = require('mongodb');
require('dotenv').config();

async function check() {
    const client = new MongoClient(process.env.MONGODB_URI);
    try {
        await client.connect();
        const db = client.db('escola_db');
        const collections = await db.listCollections().toArray();
        console.log('Collections list:', collections.map(c => c.name));

        const classesCount = await db.collection('classes').countDocuments();
        console.log('Document count in "classes":', classesCount);
        const turmasCount = await db.collection('turmas').countDocuments();
        console.log('Document count in "turmas":', turmasCount);
    } catch (e) {
        console.error(e);
    } finally {
        await client.close();
    }
}
check();
