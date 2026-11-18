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

  it('conserva hasta 3 imágenes, en el orden en que llegaron', () => {
    const form = ApplicationForm.submit({
      ...valid,
      imageIds: ['img-2', 'img-1', 'img-3'],
    });

    expect(form.props.imageIds).toEqual(['img-2', 'img-1', 'img-3']);
  });

  it('sin imágenes no guarda la lista', () => {
    const form = ApplicationForm.submit({ ...valid, imageIds: [] });

    expect(form.props).toEqual({ age: 25, city: 'Bogotá' });
  });

  it.each([
    ['con 4 imágenes', ['a', 'b', 'c', 'd']],
    ['con una imagen repetida', ['a', 'a']],
  ])('se rechaza %s', (_, imageIds) => {
    expect(() => ApplicationForm.submit({ ...valid, imageIds })).toThrow(
      InvalidApplicationFormError,
    );
  });

  it('la lista de imágenes tampoco se puede editar', () => {
    const imageIds = ['a', 'b'];
    const form = ApplicationForm.submit({ ...valid, imageIds });
    imageIds.push('c');

    expect(form.props.imageIds).toEqual(['a', 'b']);
    expect(Object.isFrozen(form.props.imageIds)).toBe(true);
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
