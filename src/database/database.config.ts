import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

export default registerAs('database', () => {
    const values = {
        dbHost: process.env.DB_HOST,
        dbUser: process.env.DB_USER,
        dbName: process.env.DB_NAME,
        dbPassword: process.env.DB_PASSWORD,
        uri: process.env.DB_URI,
    };
    const schema = Joi.object({
        dbHost: Joi.string().required(),
        dbUser: Joi.string().required(),
        dbName: Joi.string().required(),
        dbPassword: Joi.string().required(),
        uri: Joi.string().required(),
    });

    const { error } = schema.validate(values, { abortEarly: false });
    if (error) {
        const message = `Validation failed - Is there an Database variable missinng? ${error.message}`;

        throw new Error(message);
    }

    return values;
});