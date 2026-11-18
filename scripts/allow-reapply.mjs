// Permite que un usuario vuelva a aplicar al grupo: borra su solicitud (`requestchats`)
// y los mensajes de su chat (`requestchatmessages`). `requestchats.requester` es único,
// así que mientras exista su solicitud, sea cual sea su estado, no puede enviar otra.
//
// Uso (desde la raíz del repo):
//
//   npm run allow-reapply              # contra DB_URI (desarrollo)
//   npm run allow-reapply -- --prod    # contra DB_URI_PRODUCTION
//   npm run allow-reapply -- Kittensune --prod    # con el username ya dado
//
// Lee las URIs del `.env`. Pide el username (con o sin @), busca al usuario y su solicitud
// y muestra qué borraría. Solo borra si se escribe el nombre de la base para confirmar,
// porque staging y producción comparten cluster. Antes de borrar copia la solicitud y sus
// mensajes en `requestchats_deleted` y `requestchatmessages_deleted`. El documento de
// `users` no se toca.
import { createInterface } from 'node:readline/promises';
import mongoose from 'mongoose';

const args = process.argv.slice(2);
const prod = args.includes('--prod');
const uri = prod ? process.env.DB_URI_PRODUCTION : process.env.DB_URI;
if (!uri) {
    console.error(`Falta la variable ${prod ? 'DB_URI_PRODUCTION' : 'DB_URI'} (revisa el .env)`);
    process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const client = new mongoose.mongo.MongoClient(uri);

async function main() {
    await client.connect();
    const db = client.db();
    console.log(`Base de datos: ${db.databaseName}${prod ? ' (PRODUCCIÓN)' : ''}\n`);

    const typed = args.find((arg) => !arg.startsWith('--')) ?? (await rl.question('Username del usuario: '));
    const username = typed.trim().replace(/^@/, '');
    if (!username) {
        console.error('Falta el username');
        process.exitCode = 1;
        return;
    }

    // Telegram no distingue mayúsculas en los usernames y `users.username` puede variar.
    const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const users = await db
        .collection('users')
        .find({ username: { $regex: `^${escaped}$`, $options: 'i' } })
        .toArray();
    if (users.length === 0) {
        console.error(`No hay ningún usuario con username "${username}"`);
        process.exitCode = 1;
        return;
    }
    if (users.length > 1) {
        console.error(`Hay ${users.length} usuarios con username "${username}"; se debe borrar a mano:`);
        for (const u of users) console.error(`  ${u._id} (telegramId ${u.telegramId})`);
        process.exitCode = 1;
        return;
    }
    const user = users[0];
    console.log(`Usuario: ${user.name} (@${user.username}), telegramId ${user.telegramId}, isMember: ${user.isMember}`);

    const requestChats = db.collection('requestchats');
    const messages = db.collection('requestchatmessages');
    const request = await requestChats.findOne({ requester: user._id });
    if (!request) {
        console.log('No tiene solicitud: ya puede aplicar. Nada que hacer.');
        return;
    }
    const messageCount = await messages.countDocuments({ requestChatId: request._id });
    console.log(
        `Solicitud: ${request.state}${request.legacy ? ' (legacy)' : ''}, creada ${request.createdAt?.toISOString()}, ` +
            `${request.votes?.length ?? 0} votos, ${request.endorsements?.length ?? 0} avales, ${messageCount} mensajes`,
    );
    if (user.isMember) {
        console.log('\nAVISO: el usuario figura como miembro. Borrar la solicitud no lo saca del grupo.');
    }

    const answer = await rl.question(`\nPara borrarla escribe el nombre de la base (${db.databaseName}), o Enter para cancelar: `);
    if (answer.trim() !== db.databaseName) {
        console.log('Cancelado, no se borró nada.');
        return;
    }

    await db.collection('requestchats_deleted').replaceOne({ _id: request._id }, { ...request, deletedAt: new Date() }, { upsert: true });
    const chatMessages = await messages.find({ requestChatId: request._id }).toArray();
    const backup = db.collection('requestchatmessages_deleted');
    for (const message of chatMessages) {
        await backup.replaceOne({ _id: message._id }, message, { upsert: true });
    }

    const deletedMessages = await messages.deleteMany({ requestChatId: request._id });
    const deletedRequest = await requestChats.deleteOne({ _id: request._id, requester: user._id });
    console.log(
        `\nListo: ${deletedRequest.deletedCount} solicitud y ${deletedMessages.deletedCount} mensajes borrados ` +
            `(copia en requestchats_deleted / requestchatmessages_deleted). @${user.username} ya puede volver a aplicar.`,
    );
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        rl.close();
        await client.close();
    });
