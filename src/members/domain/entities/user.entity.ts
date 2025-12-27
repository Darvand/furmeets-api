import { Entity } from "src/shared/domain/entities/entity";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";

// type Species = "Bird" | "Feline" | "Canine" | "Dragon" | "Deer" | "Other";
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
    avatarUrl?: string;
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

    get id(): UUID {
        return this._id;
    }

    get username(): string | undefined {
        return this.props.username;
    }

    get avatarUrl(): string | undefined {
        return this.props.avatarUrl;
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