/* eslint-disable no-param-reassign,func-names */

import Mousetrap from 'mousetrap';
import { isArray } from 'lodash';

function bind(el, value, bindElement) {
  const mousetrap = new Mousetrap(bindElement ? el : undefined);
  el.mousetrap = mousetrap;
  if (!isArray(value)) {
    value = [value];
  }
  value.forEach(({ bind: _bind, handler, disabled }) => {
    if (!disabled) {
      mousetrap.bind(_bind, function (...args) {
        handler.apply(this, [el, ...args]);
      });
    }
  });
}

function unbind(el) {
  el.mousetrap.reset();
}

export default {
  install(app) {
    app.directive('mousetrap', {
      mounted(el, { value, modifiers }) {
        bind(el, value, modifiers.element);
      },
      updated(el, { value, modifiers }) {
        unbind(el);
        bind(el, value, modifiers.element);
      },
      unmounted(el) {
        unbind(el);
      },
    });
  },
};
