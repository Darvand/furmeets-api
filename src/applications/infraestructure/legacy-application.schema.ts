import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** Respuestas del formulario anterior, embebidas en su `requestchats` (`legacy`). */
@Schema({ _id: false })
export class LegacyApplicationDoc {
  @Prop()
  howDidYouFindUs?: string;

  @Prop()
  interests?: string;
}

export const LegacyApplicationSchema =
  SchemaFactory.createForClass(LegacyApplicationDoc);
