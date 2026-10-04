import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { type mongo } from 'mongoose';

/**
 * Formulario de solicitud, embebido en su `requestchats` (una solicitud por usuario).
 * Los formularios enviados antes del 2026-10-03 pueden traer `pronouns`: ya no se lee.
 */
@Schema({ _id: false })
export class ApplicationFormDoc {
  /** Ids de `media`. Con `lean()` llegan como `Binary`. */
  @Prop({ type: [mongoose.Schema.Types.UUID], default: undefined })
  imageIds?: (string | mongo.Binary)[];

  @Prop()
  fursonaName?: string;

  @Prop()
  species?: string;

  @Prop({ required: true })
  age: number;

  @Prop({ required: true })
  city: string;

  @Prop()
  socialLinks?: string;

  @Prop()
  howDidYouFindUs?: string;

  @Prop()
  knowsSomeone?: string;

  @Prop()
  previousMeets?: string;
}

export const ApplicationFormSchema =
  SchemaFactory.createForClass(ApplicationFormDoc);
