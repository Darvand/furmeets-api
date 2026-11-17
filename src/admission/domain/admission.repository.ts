import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import type { Admission } from './admission';

export const ADMISSION_REPOSITORY = Symbol('AdmissionRepository');

/**
 * Los datos de admisión viven en el documento de la solicitud. Cada escritura es una
 * operación atómica y condicional (ADR-001, regla 2).
 */
export interface AdmissionRepository {
  findById(requestChatId: UUID): Promise<Admission | null>;
  findByRequester(requesterId: UUID): Promise<Admission | null>;
  /**
   * Guarda el enlace si la solicitud está aprobada y todavía no tiene uno. Devuelve si
   * esta llamada lo guardó.
   */
  saveInviteLink(requestChatId: UUID, inviteLink: string): Promise<boolean>;
  /** Marca que el solicitante entró, una sola vez. Devuelve si esta llamada lo marcó. */
  markAdmitted(requestChatId: UUID, at: Date): Promise<boolean>;
}
