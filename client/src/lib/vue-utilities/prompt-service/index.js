/* disabled this rule for Vue.prototype.FOO = */
/* eslint-disable no-param-reassign,func-names */

import Prompt from './Prompt.vue';

export default function (vuetify) {
  return function install(Vue) {
    Prompt.vuetify = vuetify;
    const PromptComponent = Vue.extend(Prompt);
    const component = new PromptComponent();
    Vue.prototype.$promptAttach = function () {
      const div = document.createElement('div');
      this.$el.appendChild(div);
      component.$mount(div);
      return this;
    };
    Vue.prototype.$prompt = ({
      title,
      text,
      positiveButton = 'Confirm',
      negativeButton = 'Cancel',
      confirm = false,
    } = {}) => {
      let resolve;
      const p = new Promise((_resolve) => {
        resolve = _resolve;
      });
      function set() {
        component.$data.title = title;
        component.$data.text = text;
        component.$data.positiveButton = positiveButton;
        component.$data.negativeButton = negativeButton;
        component.$data.confirm = confirm;
        component.$data.resolve = resolve;
        component.$data.show = true;
      }
      if (!component.$data.show) {
        set();
      } else {
        const unwatch = component.$watch('show', () => {
          unwatch();
          set();
        });
      }
      return p;
    };
    Vue.prototype.$prompt.hide = () => {
      component.$data.show = false;
    };
  };
}
