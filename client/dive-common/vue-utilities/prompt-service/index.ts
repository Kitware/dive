/* disabled this rule for Vue.prototype.FOO = */
/* eslint-disable no-param-reassign,func-names */

import {
  App, createApp, watch, Component,
} from 'vue';
import { createVuetify } from 'vuetify';
import vMousetrap from 'dive-common/vue-utilities/v-mousetrap';
import Prompt from './Prompt.vue';

type VuetifyInstance = ReturnType<typeof createVuetify>;

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

  constructor(vuetify: VuetifyInstance) {
    const mountEl = document.createElement('div');
    const app = createApp(Prompt as Component);
    app.use(vuetify);
    app.use(vMousetrap);
    const component = app.mount(mountEl);
    this.component = component;
    this.component.$mountEl = mountEl;
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
        const unwatch = watch(() => this.component.show, () => {
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
    element.appendChild(this.component.$mountEl);
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

export default function (vuetify: VuetifyInstance) {
  return {
    install(app: App) {
      promptService = new PromptService(vuetify);

      app.config.globalProperties.$promptAttach = function attachPrompt(this: { $el: HTMLElement }) {
        const div = document.createElement('div');
        this.$el.appendChild(div);
        if (promptService) {
          promptService.mount(div);
        }
        return this;
      };
    },
  };
}
