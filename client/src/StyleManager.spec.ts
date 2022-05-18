/// <reference types="jest" />

import CompositionApi, { ref } from '@vue/composition-api';
import Vue from 'vue';

import type Vuetify from 'vuetify/lib';

import StyleManager from './StyleManager';


Vue.use(CompositionApi);

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
    const markChangesPending = jest.fn();
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
    const markChangesPending = jest.fn();
    const sm = new StyleManager({ markChangesPending, vuetify });
    expect(sm.getTypeStyles(ref([]))).toEqual({});
    /** Colors are deterministically generated in order */
    expect(sm.getTypeStyles(ref(['foo']))).toEqual({ foo: { color: '#ffe080' } });
  });
});
