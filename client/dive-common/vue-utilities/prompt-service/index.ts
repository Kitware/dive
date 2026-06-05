import {
  App, createApp, inject, watch, type InjectionKey,
} from 'vue';

import vMousetrap from '../v-mousetrap';

import Prompt from './Prompt.vue';

interface PromptParams {
  title: string;
  text: string | string[];
  positiveButton?: string;
  negativeButton?: string;
  confirm?: boolean;
}

export const promptServiceKey: InjectionKey<PromptService> = Symbol('promptService');

class PromptService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private component: any;

  constructor(vuetify: { install: (app: App) => void }) {
    const mountPoint = document.createElement('div');
    document.body.appendChild(mountPoint);
    const promptApp = createApp(Prompt);
    promptApp.use(vuetify);
    promptApp.use(vMousetrap);
    this.component = promptApp.mount(mountPoint);
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
        const unwatch = watch(() => this.component.show, (value) => {
          if (!value) {
            unwatch();
            this.set(title, text, positiveButton, negativeButton, confirm, resolve);
          }
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
}

let promptService: PromptService | null = null;

export function usePrompt() {
  const service = inject(promptServiceKey) || promptService;
  if (!service) {
    throw new Error('Prompt service is not installed');
  }
  const prompt = (params: PromptParams) => service.show(params);
  const visible = () => service.visible();
  const invisible = () => service.invisible();
  const hide = () => service.hide();

  return {
    prompt, visible, invisible, hide,
  };
}

export default function installPromptService(vuetify: { install: (app: App) => void }) {
  return (app: App) => {
    promptService = new PromptService(vuetify);
    app.provide(promptServiceKey, promptService);
  };
}
