require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

async function list() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        console.log('COLLECTIONS_LIST_START');
        for (const col of collections) {
            console.log(col.name);
        }
        console.log('COLLECTIONS_LIST_END');
        await mongoose.disconnect();
    } catch (err) {
        console.error(err);
    }
}
list();
