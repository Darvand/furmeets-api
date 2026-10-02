import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

export default registerAs('telegramBot', () => {
    const values = {
        token: process.env.TELEGRAM_BOT_TOKEN!,
        mainChatId: process.env.TELEGRAM_GROUP_ID!,
        /**
         * Canal privado donde el bot guarda las imágenes subidas (SPEC §4.3). Opcional: sin
         * él, avatares y foto del grupo se sirven igual; solo falla la subida (503).
         */
        storageChatId: process.env.TELEGRAM_STORAGE_CHAT_ID || undefined,
    };
    const schema = Joi.object({
        token: Joi.string().required(),
        mainChatId: Joi.string().required(),
        storageChatId: Joi.string().optional(),
    });

    const { error } = schema.validate(values, { abortEarly: false });
    if (error) {
        const message = `Validation failed - Is there an TelegramBot variable missinng? ${error.message}`;

        throw new Error(message);
    }

    return values;
});
