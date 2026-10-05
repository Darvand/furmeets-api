interface ValueObjectProps {
  [index: string]: any;
}

export abstract class ValueObject<T extends ValueObjectProps> {
  public readonly props: T;

  constructor(props: T) {
    this.props = Object.freeze(props);
  }

  /**
   * Igualdad por valor: misma clase y mismas `props`. Compara cada prop de forma
   * superficial, con recursión en value objects anidados, listas (en orden) y fechas (por
   * instante). Una prop ausente equivale a una en `undefined`.
   */
  public equals(vo?: ValueObject<T>): boolean {
    if (vo === null || vo === undefined) {
      return false;
    }
    if (vo === this) {
      return true;
    }
    if (vo.constructor !== this.constructor) {
      return false;
    }
    return sameProps(this.props, vo.props);
  }
}

function sameProps(a: ValueObjectProps, b: ValueObjectProps): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!sameValue(a[key], b[key])) {
      return false;
    }
  }
  return true;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof ValueObject) {
    return a.equals(b as ValueObject<ValueObjectProps>);
  }
  if (Array.isArray(a)) {
    return (
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameValue(item, b[i]))
    );
  }
  if (a instanceof Date) {
    return b instanceof Date && a.getTime() === b.getTime();
  }
  return Object.is(a, b);
}
