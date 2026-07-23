import { ref } from 'vue';

import type Vuetify from 'vuetify/lib';

import StyleManager from './StyleManager';

const vuetify = {
  preset: {
    theme: {
      themes: {
        dark: {
          accent: 'blue',
        },
      },
    },
  },
} as Vuetify;

describe('StyleManager', () => {
  it('can updates custom colors', () => {
    const markChangesPending = vi.fn();
    const sm = new StyleManager({ markChangesPending, vuetify });
    const beforeSetColor = sm.typeStyling.value.color('foo');
    const beforeSetStrokeWidth = sm.typeStyling.value.strokeWidth('bar');
    sm.updateTypeStyle({ type: 'bar', value: { color: 'green' } });
    expect(sm.typeStyling.value.color('foo')).toBe(beforeSetColor);
    expect(sm.typeStyling.value.color('foo')).not.toBe('green');
    expect(sm.typeStyling.value.color('bar')).toBe('green');
    expect(sm.typeStyling.value.strokeWidth('bar')).toBe(beforeSetStrokeWidth);
    expect(markChangesPending.mock.calls.length).toBe(1);
  });

  it('returns custom saved colors', () => {
    const markChangesPending = vi.fn();
    const sm = new StyleManager({ markChangesPending, vuetify });
    expect(sm.getTypeStyles(ref([]))).toEqual({});
    /** Colors are deterministically generated in order */
    expect(sm.getTypeStyles(ref(['foo']))).toEqual({ foo: { color: '#ffe080' } });
  });
});

describe('suppressed-display style blending', () => {
  it('blends the suppression style 50/50 with the natural type', () => {
    const markChangesPending = () => undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sm = new StyleManager({ markChangesPending } as any);
    sm.updateTypeStyle({ type: 'B', value: { color: '#000000', opacity: 0.5 } });
    sm.updateTypeStyle({ type: 'Suppressed', value: { color: '#ffffff', opacity: 1.0 } });
    // 0.5 * 255 + 0.5 * 0 = 127.5 -> 128 = 0x80 per channel
    expect(sm.typeStyling.value.suppressedColor('B', 'Suppressed')).toBe('#808080');
    expect(sm.typeStyling.value.suppressedOpacity('B', 'Suppressed')).toBeCloseTo(0.75, 6);
  });
});
