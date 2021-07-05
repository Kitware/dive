/* disabled this rule for Vue.prototype.FOO = */
/* eslint-disable no-param-reassign,func-names */

import { VueConstructor } from 'vue';
import { watch } from '@vue/composition-api';
import Vuetify from 'vuetify/lib';
import Prompt from './Prompt.vue';

interface PromptParams {
  title: string;
  text: string | string[];
  positiveButton?: string;
  negativeButton?: string;
  confirm?: boolean;
}

class PromptService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private component: any;

  constructor(Vue: VueConstructor, vuetify: Vuetify) {
    const PromptComponent = Vue.extend({ vuetify, ...Prompt });
    const component = new PromptComponent();
    this.component = component;
  }

  set(
    title: string,
    text: string | string[],
    positiveButton: string,
    negativeButton: string,
    confirm: boolean,
    resolve: (value: boolean) => unknown,
  ): void {
    this.component.title = title;
    this.component.text = text;
    this.component.positiveButton = positiveButton;
    this.component.negativeButton = negativeButton;
    this.component.confirm = confirm;
    this.component.functions.resolve = resolve;
    this.component.show = true;
  }

  show({
    title,
    text,
    positiveButton = 'Confirm',
    negativeButton = 'Cancel',
    confirm = false,
  }: PromptParams): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (!this.component.show) {
        this.set(title, text, positiveButton, negativeButton, confirm, resolve);
      } else {
        const unwatch = watch(this.component.show, () => {
          unwatch();
          this.set(title, text, positiveButton, negativeButton, confirm, resolve);
        });
      }
    });
  }

  visible(): boolean {
    return this.component.show;
  }

  invisible(): boolean {
    return !this.component.show;
  }

  hide(): void {
    this.component.show = false;
  }

  mount(element: HTMLElement): void {
    this.component.$mount(element);
  }
}

// in vue 3 should use provide/inject with symbol
let promptService: PromptService;

export function usePrompt() {
  // in vue 3 should use inject instead of singleton
  const prompt = (params: PromptParams) => promptService.show(params);
  const visible = () => promptService.visible();
  const invisible = () => promptService.invisible();
  const hide = () => promptService.hide();

  return {
    prompt, visible, invisible, hide,
  };
}

export default function (vuetify: Vuetify) {
  return function install(Vue: VueConstructor) {
    // in vue 3 should use provide instead of singleton
    promptService = new PromptService(Vue, vuetify);

    Vue.prototype.$promptAttach = function () {
      const div = document.createElement('div');
      this.$el.appendChild(div);
      if (promptService) {
        promptService.mount(div);
      }
      return this;
    };
  };
}
