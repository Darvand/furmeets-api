import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

export default registerAs('telegramBot', () => {
    const values = {
        token: process.env.TELEGRAM_BOT_TOKEN!,
        chatId: process.env.TELEGRAM_CHAT_ID!,
    };
    const schema = Joi.object({
        token: Joi.string().required(),
        chatId: Joi.string().required(),
    });

    const { error } = schema.validate(values, { abortEarly: false });
    if (error) {
        const message = `Validation failed - Is there an TelegramBot variable missinng? ${error.message}`;

        throw new Error(message);
    }

    return values;
});