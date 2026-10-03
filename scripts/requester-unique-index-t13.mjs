// T13 — Una solicitud por usuario: índice único en `requestchats.requester`.
//
// Uso:
//   DB_URI="mongodb+srv://.../<base>" node scripts/requester-unique-index-t13.mjs
//   DB_URI=... CONFIRM=<base> node scripts/requester-unique-index-t13.mjs --apply
//
// Sin `--apply` solo lee: detecta usuarios con más de una solicitud (con ellos el índice
// único no se puede crear) y muestra el índice actual de `requester`.
//
// Con `--apply`, y solo si no hay duplicados, deja `requester_1` como único. T38 lo creó no
// único y Mongoose no cambia las opciones de un índice que ya existe: hay que borrarlo y
// crearlo de nuevo. Mientras tanto la regla se sigue cumpliendo con la lectura previa del
// servicio; el índice solo cubre dos envíos simultáneos. CONFIRM debe repetir el nombre
// de la base, porque staging comparte cluster con producción.
import mongoose from 'mongoose';

const uri = process.env.DB_URI;
if (!uri) {
    console.error('Falta la variable DB_URI');
    process.exit(1);
}
const apply = process.argv.includes('--apply');
const client = new mongoose.mongo.MongoClient(uri);

async function main() {
    await client.connect();
    const db = client.db();
    const requestChats = db.collection('requestchats');
    console.log(`Base de datos: ${db.databaseName}\n`);

    const duplicates = await requestChats.aggregate([
        { $group: { _id: '$requester', count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
    ]).toArray();
    if (duplicates.length > 0) {
        console.log(`ERROR: ${duplicates.length} usuarios con más de una solicitud (el índice único fallará):`);
        for (const dup of duplicates) {
            console.log(`  requester ${dup._id} → ${dup.count} solicitudes`);
        }
        process.exitCode = 1;
        return;
    }
    console.log('OK: ningún usuario tiene más de una solicitud');

    const current = (await requestChats.indexes().catch(() => [])).find((i) => i.name === 'requester_1');
    console.log(`Índice actual: ${current ? `requester_1${current.unique ? ' (unique)' : ' (no único)'}` : 'no existe'}`);
    if (current?.unique) {
        console.log('Nada que hacer.');
        return;
    }
    if (!apply) {
        console.log('\nPara dejarlo único: repetir con CONFIRM=<base> y --apply.');
        return;
    }
    if (process.env.CONFIRM !== db.databaseName) {
        console.error(`\nPara confirmar, define CONFIRM=${db.databaseName}.`);
        process.exitCode = 1;
        return;
    }
    if (current) {
        await requestChats.dropIndex('requester_1');
    }
    await requestChats.createIndex({ requester: 1 }, { name: 'requester_1', unique: true });
    console.log('Listo: requester_1 (unique)');
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => client.close());
