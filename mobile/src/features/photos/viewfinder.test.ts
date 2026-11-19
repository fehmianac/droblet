import { VIEWFINDER_MAX_WIDTH, viewfinderWidth } from './viewfinder';

describe('viewfinderWidth (12 Parça ekle)', () => {
  it('is the board width when the area is tall enough', () => {
    expect(viewfinderWidth(350, 500)).toBe(VIEWFINDER_MAX_WIDTH);
  });

  it('shrinks with the height on a short screen, keeping 29 : 37', () => {
    // iPhone SE: about 330 pt between the header and the controls.
    const w = viewfinderWidth(335, 330);
    expect(w).toBeLessThan(VIEWFINDER_MAX_WIDTH);
    expect((w * 37) / 29).toBeLessThanOrEqual(330 - 16);
  });

  it('never exceeds the width or goes negative', () => {
    expect(viewfinderWidth(200, 900)).toBe(200);
    expect(viewfinderWidth(300, 0)).toBe(0);
  });
});
