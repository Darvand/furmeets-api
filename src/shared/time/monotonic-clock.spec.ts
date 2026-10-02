import { MonotonicClock } from './monotonic-clock';

describe('MonotonicClock', () => {
  it('usa la hora real mientras avanza', () => {
    let time = 1_000;
    const clock = new MonotonicClock(() => time);

    expect(clock.now().getTime()).toBe(1_000);
    time = 1_500;
    expect(clock.now().getTime()).toBe(1_500);
  });

  it('en el mismo milisegundo avanza 1 ms por llamada', () => {
    const clock = new MonotonicClock(() => 1_000);

    expect([clock.now(), clock.now(), clock.now()].map(Number)).toEqual([
      1_000, 1_001, 1_002,
    ]);
  });

  it('si el reloj del sistema retrocede, no retrocede', () => {
    let time = 2_000;
    const clock = new MonotonicClock(() => time);
    clock.now();
    time = 1_000;

    expect(clock.now().getTime()).toBe(2_001);
  });
});
