/* disabled this rule for Vue.prototype.FOO = */
/* eslint-disable no-param-reassign,func-names */

import { watch } from '@vue/composition-api';
import Prompt from './Prompt.vue';

class PromptService {
  constructor(Vue) {
    const PromptComponent = Vue.extend(Prompt);
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

// in vue 3 should use provide/inject with symbol
let promptService = null;

export function usePrompt() {
  return promptService;
}

export default function (vuetify) {
  return function install(Vue) {
    Prompt.vuetify = vuetify;
    // in vue 3 should use provide instead of singleton
    promptService = new PromptService(Vue);
    Vue.prototype.$promptAttach = function () {
      const div = document.createElement('div');
      this.$el.appendChild(div);
      promptService.component.$mount(div);
      return this;
    };
  };
}
