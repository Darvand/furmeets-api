/** Lo mínimo de una entidad de Telegram: negrita y enlace sobre el encabezado. */
export type GroupEntity =
  | { type: 'bold'; offset: number; length: number }
  | { type: 'text_link'; offset: number; length: number; url: string };

/** Un texto del grupo, o el pie de una foto, con sus entidades. */
export interface GroupText {
  text: string;
  entities: GroupEntity[];
}

/** Límites de la Bot API: un mensaje de texto y el pie de una foto. */
export const TEXT_MAX_LENGTH = 4096;
export const CAPTION_MAX_LENGTH = 1024;

/** Cómo llega un mensaje del solicitante al grupo. */
export interface Republication {
  /** El mensaje de texto, o el pie de las fotos si las hay. Lleva el encabezado. */
  head: GroupText;
  /** Texto que no cabe en el pie de las fotos: va en un mensaje aparte, sin encabezado. */
  overflow?: GroupText;
}

export interface RepublicationInput {
  requesterName: string;
  /** Enlace a la solicitud en la App: el encabezado lo lleva. */
  link: string;
  content: string;
  hasImages: boolean;
}

/**
 * Texto de usuario en texto plano con entidades, sin `parse_mode`: ningún `*` ni `_` del
 * solicitante puede hacer que Telegram rechace el mensaje.
 */
export function republicationOf(input: RepublicationInput): Republication {
  const header = `${input.requesterName} · solicitud`;
  const content = input.content.trim() ? input.content : '';
  const entities: GroupEntity[] = [
    { type: 'bold', offset: 0, length: header.length },
    { type: 'text_link', offset: 0, length: header.length, url: input.link },
  ];
  const withHeader = (body: string): GroupText => ({
    text: body ? `${header}\n${body}` : header,
    entities,
  });

  if (!input.hasImages) {
    return {
      head: withHeader(truncate(content, TEXT_MAX_LENGTH - header.length - 1)),
    };
  }
  if (header.length + 1 + content.length <= CAPTION_MAX_LENGTH) {
    return { head: withHeader(content) };
  }
  return {
    head: withHeader(''),
    overflow: { text: truncate(content, TEXT_MAX_LENGTH), entities: [] },
  };
}

/** Recorta a `max` unidades UTF-16 sin partir un par sustituto, con "…" al final. */
function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  let cut = text.slice(0, max - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}
