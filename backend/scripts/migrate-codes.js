const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;

async function migrate() {
    try {
        console.log('Connecting to database...');
        await mongoose.connect(MONGODB_URI);
        console.log('Connected!');

        const { initializeSecretCodes } = require('../src/utils/secretCodeHelper');
        await initializeSecretCodes();

        console.log('Done!');
        await mongoose.disconnect();
        console.log('Disconnected!');
    } catch (err) {
        console.error('Error during migration:', err);
    }
}

migrate();
