import Vue from 'vue';

interface PromptParams {
  title: string;
  text: string;
  positiveButton?: string;
  negativeButton?: string;
  confirm?: boolean;
}
declare module 'vue/types/vue' {
  interface Vue {
    $promptAttach(): Vue;
    $prompt(arg: PromptParams): Promise<unknown>;
    $snackbarAttach(): Vue;
    $snackbar(): Promise<unknown>;
  }
}
