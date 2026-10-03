import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** Formulario de solicitud, embebido en su `requestchats` (una solicitud por usuario). */
@Schema({ _id: false })
export class ApplicationFormDoc {
  @Prop()
  fursonaName?: string;

  @Prop()
  species?: string;

  @Prop()
  pronouns?: string;

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
