/* disabled this rule for Vue.prototype.FOO = */
/* eslint-disable no-param-reassign,func-names */

import Vue2 from 'vue';
import {
  provide, inject,
} from '@vue/composition-api';
import Prompt from './Prompt.vue';

class PromptService {
  constructor() {
    const PromptComponent = Vue2.extend(Prompt);
    const component = new PromptComponent();
    this.component = component;
  }

  show({
    title,
    text,
    positiveButton = 'Confirm',
    negativeButton = 'Cancel',
    confirm = false,
  } = {}) {
    let resolve;
    const p = new Promise((_resolve) => {
      resolve = _resolve;
    });
    function set(component) {
      component.title = title;
      component.text = text;
      component.positiveButton = positiveButton;
      component.negativeButton = negativeButton;
      component.confirm = confirm;
      component.resolve = resolve;
      component.show = true;
    }
    if (!this.component.$data.show) {
      set(this.component);
    } else {
      const unwatch = this.component.$watch('show', () => {
        unwatch();
        set(this.component);
      });
    }
    return p;
  }

  visible() {
    return this.component.show;
  }

  invisible() {
    return !this.component.show;
  }

  hide() {
    this.component.show = false;
  }
}

const promptSymbol = Symbol('prompt-service');

export function providePrompt() {
  const promptService = new PromptService();
  Vue2.prototype.$promptAttach = function () {
    const div = document.createElement('div');
    this.$el.appendChild(div);
    promptService.component.$mount(div);
    return this;
  };
  provide(promptSymbol, promptService);
}

export function usePrompt() {
  const prompt = inject(promptSymbol);
  return prompt;
}

export default function (vuetify) {
  return function install(Vue) {
    Prompt.vuetify = vuetify;
    const PromptComponent = Vue.extend(Prompt);
    const component = new PromptComponent();
    Vue.prototype.$promptAttachOld = function () {
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
    Vue.prototype.$prompt.visible = () => component.$data.show;
    Vue.prototype.$prompt.hide = () => {
      component.$data.show = false;
    };
  };
}
