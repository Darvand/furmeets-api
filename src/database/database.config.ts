import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

export default registerAs('database', () => {
    const values = {
        uri: process.env.DB_URI,
    };
    const schema = Joi.object({
        uri: Joi.string().required(),
    });

    const { error } = schema.validate(values, { abortEarly: false });
    if (error) {
        const message = `Validation failed - Is there an Database variable missinng? ${error.message}`;

        throw new Error(message);
    }

    return values;
});