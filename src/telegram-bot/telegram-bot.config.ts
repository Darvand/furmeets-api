import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

export default registerAs('telegramBot', () => {
    const values = {
        token: process.env.TELEGRAM_BOT_TOKEN!,
        mainChatId: process.env.TELEGRAM_MAIN_CHAT_ID!,
        welcomeForumChatId: process.env.TELEGRAM_WELCOME_FORUM_CHAT_ID!,
    };
    const schema = Joi.object({
        token: Joi.string().required(),
        mainChatId: Joi.string().required(),
        welcomeForumChatId: Joi.string().required(),
    });

    console.log("telegram values:", values);

    const { error } = schema.validate(values, { abortEarly: false });
    if (error) {
        const message = `Validation failed - Is there an TelegramBot variable missinng? ${error.message}`;

        throw new Error(message);
    }

    return values;
});