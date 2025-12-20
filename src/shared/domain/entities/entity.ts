import { UUID } from '../value-objects/uuid.value-object';

export abstract class Entity<T> {
    protected readonly _id: UUID;
    public readonly props: T;

    constructor(props: T, id?: UUID) {
        this._id = id ? id : UUID.generate();
        this.props = props;
    }
}