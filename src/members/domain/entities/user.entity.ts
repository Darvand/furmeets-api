import { Entity } from "src/shared/domain/entities/entity";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { TelegramIdentity } from "../value-objects/telegram-identity.value-object";

export const Species = Object.freeze({
    Bird: "Bird",
    Feline: "Feline",
    Canine: "Canine",
    Dragon: "Dragon",
    Deer: "Deer",
    Bunny: "Bunny",
    Wolf: "Wolf",
    Other: "Other",
});

type SpeciesType = typeof Species[keyof typeof Species];

export interface UserProps {
    username?: string;
    avatarMediaId?: string;
    name: string;
    telegramId: number;
    isMember: boolean;
    createdAt?: Date;
    species?: SpeciesType;
    birthdate?: Date;
}

export class UserEntity extends Entity<UserProps> {
    private constructor(props: UserProps, id?: UUID) {
        super(props, id);
        if (props.species && !Object.values(Species).includes(props.species)) {
            throw new Error(`Invalid species type: ${props.species}`);
        }
    }
    static create(props: UserProps, id?: UUID): UserEntity {
        return new UserEntity(props, id);
    }

    /**
     * Primer ingreso a la App: el usuario nace como no miembro (el rol se resuelve
     * contra Telegram) y sin avatar: lo guarda la sincronización con el bot (`media`).
     */
    static registerFromTelegram(identity: TelegramIdentity): UserEntity {
        return new UserEntity({
            telegramId: identity.telegramId,
            name: identity.name,
            username: identity.username,
            isMember: false,
            createdAt: new Date(),
        });
    }

    /** El usuario del bot: autor de los mensajes de sistema; siempre es miembro. */
    static registerBot(identity: TelegramIdentity): UserEntity {
        return new UserEntity({
            telegramId: identity.telegramId,
            name: identity.name,
            username: identity.username,
            isMember: true,
            createdAt: new Date(),
        });
    }

    /** Refleja la membresía según Telegram. Devuelve si cambió. */
    updateMembership(isMember: boolean): boolean {
        if (this.props.isMember === isMember) {
            return false;
        }
        this.props.isMember = isMember;
        return true;
    }

    /**
     * Reemplaza el avatar por el actual de Telegram (sin foto = sin avatar). Es el id de
     * `media`: el `file_path` de Telegram caduca y la URL lleva el token del bot.
     * Devuelve si cambió.
     */
    changeAvatar(avatarMediaId: string | undefined): boolean {
        if (this.props.avatarMediaId === avatarMediaId) {
            return false;
        }
        this.props.avatarMediaId = avatarMediaId;
        return true;
    }

    /**
     * Telegram es la fuente de verdad del nombre y del usuario, así que se toman de
     * cada `initData`. El avatar no se pisa: la sincronización con el bot guarda el suyo.
     * Pertenencia, especie y fecha de nacimiento no dependen de Telegram.
     *
     * Devuelve si algo cambió, para persistir solo cuando hace falta.
     */
    refreshFrom(identity: TelegramIdentity): boolean {
        if (identity.telegramId !== this.props.telegramId) {
            throw new Error(`Telegram identity ${identity.telegramId} does not belong to user ${this._id.value}`);
        }
        const changed = this.props.name !== identity.name || this.props.username !== identity.username;
        this.props.name = identity.name;
        this.props.username = identity.username;
        return changed;
    }

    get id(): UUID {
        return this._id;
    }

    get username(): string | undefined {
        return this.props.username;
    }

    get avatarMediaId(): string | undefined {
        return this.props.avatarMediaId;
    }

    get name(): string {
        return this.props.name;
    }

    get telegramId(): number {
        return this.props.telegramId;
    }

    get createdAt(): Date | undefined {
        return this.props.createdAt;
    }

    get isMember(): boolean {
        return this.props.isMember;
    }

    get species(): SpeciesType | undefined {
        return this.props.species;
    }

    set species(species: string | undefined) {
        if (species && !Object.values(Species).includes(species as SpeciesType)) {
            throw new Error(`Invalid species type: ${species}`);
        }
        this.props.species = species as SpeciesType;
    }

    get birthdate(): Date | undefined {
        return this.props.birthdate;
    }
}