import { randomUUID } from 'crypto';
import { ValueObject } from './value-object';

interface UUIDProps {
  value: string;
}

export class UUID extends ValueObject<UUIDProps> {
  get value(): string {
    return this.props.value;
  }

  private constructor(props: UUIDProps) {
    super(props);
  }

  static generate(): UUID {
    return new UUID({ value: randomUUID() });
  }

  static from(value?: string): UUID {
    if (!value) {
      return UUID.generate();
    }
    return new UUID({ value });
  }
}
