// T38 — Verificación de índices (solo lectura).
//
// Uso:
//   node --env-file=.env scripts/check-indexes-t38.mjs
//   DB_URI="mongodb+srv://..." node scripts/check-indexes-t38.mjs
//
// 1. Antes del despliegue: detecta `telegramId` duplicados o ausentes en `users`,
//    que harían fallar la creación del índice único.
// 2. Después del despliegue: lista los índices y muestra el plan ganador (`IXSCAN` / `COLLSCAN`)
//    de las tres búsquedas cubiertas por T38.
//
// No escribe nada en la base de datos.
import mongoose from 'mongoose';

const uri = process.env.DB_URI;
if (!uri) {
    console.error('Falta la variable DB_URI');
    process.exit(1);
}

const client = new mongoose.mongo.MongoClient(uri);

function planStages(explain) {
    const json = JSON.stringify(explain.queryPlanner?.winningPlan ?? {});
    return ['IXSCAN', 'COLLSCAN', 'IDHACK', 'EXPRESS_IXSCAN'].filter(stage => json.includes(`"${stage}"`));
}

async function main() {
    await client.connect();
    const db = client.db();
    const users = db.collection('users');
    const groups = db.collection('groups');
    const requestChats = db.collection('requestchats');

    console.log(`Base de datos: ${db.databaseName}\n`);

    // --- 1. Duplicados en users.telegramId -------------------------------------------------
    const duplicates = await users.aggregate([
        { $group: { _id: '$telegramId', count: { $sum: 1 }, ids: { $push: '$_id' } } },
        { $match: { count: { $gt: 1 } } },
    ]).toArray();
    const missing = await users.countDocuments({ telegramId: { $in: [null] } });

    console.log('== users.telegramId ==');
    if (duplicates.length === 0) {
        console.log('OK: sin telegramId duplicados');
    } else {
        process.exitCode = 2;
        console.log(`ERROR: ${duplicates.length} telegramId duplicados (el índice único fallará):`);
        for (const dup of duplicates) {
            console.log(`  telegramId=${dup._id} count=${dup.count} _ids=${dup.ids.map(String).join(', ')}`);
        }
    }
    if (missing > 1) {
        console.log(`ERROR: ${missing} usuarios sin telegramId (cuentan como duplicados de null en el índice único)`);
    } else if (missing === 1) {
        console.log('AVISO: 1 usuario sin telegramId (no rompe el índice, pero un segundo sí)');
    } else {
        console.log('OK: todos los usuarios tienen telegramId');
    }

    // --- 2. Índices existentes ---------------------------------------------------------------
    console.log('\n== Índices ==');
    for (const collection of [users, groups, requestChats]) {
        const indexes = await collection.indexes().catch(() => []);
        console.log(`${collection.collectionName}: ${indexes.map(i => `${i.name}${i.unique ? ' (unique)' : ''}`).join(', ') || '(colección vacía o inexistente)'}`);
    }

    // --- 3. explain() de las tres búsquedas --------------------------------------------------
    console.log('\n== explain() ==');
    const sampleUser = await users.findOne({}, { projection: { telegramId: 1 } });
    const sampleGroup = await groups.findOne({}, { projection: { telegramId: 1 } });
    const sampleChat = await requestChats.findOne({}, { projection: { requester: 1 } });

    const queries = [
        ['users.findOne({ telegramId })', users, { telegramId: sampleUser?.telegramId ?? 0 }],
        ['groups.findOne({ telegramId })', groups, { telegramId: sampleGroup?.telegramId ?? 0 }],
        ['requestchats.exists({ requester })', requestChats, { requester: sampleChat?.requester ?? null }],
    ];
    for (const [label, collection, filter] of queries) {
        const explain = await collection.find(filter).limit(1).explain('queryPlanner');
        const stages = planStages(explain);
        const ok = stages.includes('IXSCAN') || stages.includes('EXPRESS_IXSCAN');
        console.log(`${ok ? 'OK   ' : 'FALLA'} ${label}: ${stages.join(' > ') || 'plan desconocido'}`);
    }
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => client.close());
