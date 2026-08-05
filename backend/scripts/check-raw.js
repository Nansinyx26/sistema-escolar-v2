const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;

async function checkRaw() {
    try {
        await mongoose.connect(MONGODB_URI);
        const rawDoc = await mongoose.connection.db.collection('alunos').findOne({});
        console.log('Raw Document _id:', rawDoc._id, 'Type of _id:', typeof rawDoc._id, 'Is ObjectId:', rawDoc._id instanceof mongoose.Types.ObjectId);
        await mongoose.disconnect();
    } catch (err) {
        console.error('Error:', err);
    }
}

checkRaw();
