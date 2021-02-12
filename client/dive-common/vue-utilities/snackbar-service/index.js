/* disabled this rule for Vue.prototype.FOO = */
/* eslint-disable no-param-reassign,func-names */

import Snackbar from './Snackbar.vue';

export default function (vuetify) {
  return function install(Vue) {
    Snackbar.vuetify = vuetify;
    const SnackbarComponent = Vue.extend(Snackbar);
    const component = new SnackbarComponent();
    Vue.prototype.$snackbarAttach = function (options) {
      if (options) {
        component.$data.options = options;
      }
      const div = document.createElement('div');
      this.$el.appendChild(div);
      component.$mount(div);
      return this;
    };
    Vue.prototype.$snackbar = function ({
      text,
      title,
      button,
      callback,
      timeout,
      immediate,
    }) {
      function set() {
        component.$data.text = text;
        component.$data.title = title;
        component.$data.button = button;
        component.$data.callback = callback;
        component.$data.timeout = timeout || 2000;
        component.$data.show = true;
      }
      if (!component.$data.show) {
        set();
      } else if (immediate) {
        component.$data.show = false;
        setTimeout(set, 0);
      } else {
        const unwatch = component.$watch('show', () => {
          unwatch();
          set();
        });
      }
    };
    Vue.prototype.$snackbar.hide = () => {
      component.$data.show = false;
    };
    Vue.prototype.$snackbar.setOptions = (options) => {
      component.$data.options = options;
    };
  };
}
