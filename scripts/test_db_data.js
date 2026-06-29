const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../backend/.env') });

const NotaSchema = new mongoose.Schema({
    alunoId: String,
    turmaId: String,
    materiaId: String,
    nota: Number
}, { collection: 'notas' });

const Nota = mongoose.model('Nota', NotaSchema);

async function testQuery() {
    try {
        const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sistema-escolar';
        console.log('Connecting to:', uri);
        await mongoose.connect(uri);
        
        const sample = await Nota.findOne().lean();
        console.log('Sample Nota:', sample);
        
        const count = await Nota.countDocuments();
        console.log('Total Notas:', count);

        const pipeline = [
            {
                $group: {
                    _id: { materia: "$materiaId", turma: "$turmaId" },
                    media: { $avg: "$nota" }
                }
            }
        ];
        const agg = await Nota.aggregate(pipeline);
        console.log('Aggregation sample:', agg.slice(0, 5));

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.connection.close();
    }
}

testQuery();
