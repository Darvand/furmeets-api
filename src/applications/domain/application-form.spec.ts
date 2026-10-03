import {
  ApplicationForm,
  type ApplicationFormProps,
  InvalidApplicationFormError,
} from './application-form';

const valid: ApplicationFormProps = {
  age: 25,
  city: 'Bogotá',
};

describe('ApplicationForm', () => {
  it('con edad y ciudad basta: lo demás es opcional', () => {
    const form = ApplicationForm.submit(valid);

    expect(form.props).toEqual({ age: 25, city: 'Bogotá' });
  });

  it.each([
    ['con edad 0', { age: 0 }],
    ['con edad negativa', { age: -3 }],
    ['con edad no entera', { age: 17.5 }],
    ['con ciudad vacía', { city: '   ' }],
  ])('se rechaza %s', (_, overrides) => {
    expect(() => ApplicationForm.submit({ ...valid, ...overrides })).toThrow(
      InvalidApplicationFormError,
    );
  });

  it('recorta los textos y descarta los opcionales vacíos', () => {
    const form = ApplicationForm.submit({
      ...valid,
      city: '  Medellín ',
      fursonaName: '  Kiba ',
      species: '   ',
      howDidYouFindUs: 'Por un amigo',
    });

    expect(form.props).toEqual({
      age: 25,
      city: 'Medellín',
      fursonaName: 'Kiba',
      howDidYouFindUs: 'Por un amigo',
    });
  });

  it.each([
    [17, true],
    [18, false],
    [30, false],
  ])('con %i años, menor de edad: %s', (age, minor) => {
    expect(ApplicationForm.submit({ ...valid, age }).isMinor).toBe(minor);
  });

  it('no se puede editar una vez enviado', () => {
    const form = ApplicationForm.submit(valid);

    expect(Object.isFrozen(form.props)).toBe(true);
    expect(() => {
      (form.props as { city: string }).city = 'Cali';
    }).toThrow(TypeError);
    // Solo tiene lectura: ningún método lo modifica.
    const methods = Object.getOwnPropertyNames(ApplicationForm.prototype);
    expect(methods.sort()).toEqual(['constructor', 'isMinor']);
  });
});
