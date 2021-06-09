/* disabled this rule for Vue.prototype.FOO = */
/* eslint-disable no-param-reassign,func-names */

import Vue2 from 'vue';
import {
  provide, inject, watch,
} from '@vue/composition-api';
import Prompt from './Prompt.vue';

class PromptService {
  constructor() {
    const PromptComponent = Vue2.extend(Prompt);
    const component = new PromptComponent();
    this.component = component;
  }

  set(title, text, positiveButton, negativeButton, confirm, resolve) {
    this.component.title = title;
    this.component.text = text;
    this.component.positiveButton = positiveButton;
    this.component.negativeButton = negativeButton;
    this.component.confirm = confirm;
    this.component.resolve = resolve;
    this.component.show = true;
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

    if (!this.component.show) {
      this.set(title, text, positiveButton, negativeButton, confirm, resolve);
    } else {
      const unwatch = watch(this.component.show, () => {
        unwatch();
        this.set(title, text, positiveButton, negativeButton, confirm, resolve);
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
  };
}
