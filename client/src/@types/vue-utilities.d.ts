import Vue from 'vue';

interface PromptParams {
  title: string;
  text: string;
  positiveButton?: string;
  negativeButton?: string;
  confirm?: boolean;
}

interface SnackBarParams{
    text: string;
    button: string;
    callback?: () => void;
    timeout?: number;
    immediate?: boolean;
}
interface SnackBarMethods {
  setOptions: ({
    bottom, top, right, left, app,
  }: {bottom?: boolean; top?: boolean; right?: boolean; left?: boolean; app?: boolean }) => void;
  hide: () => void;
}

declare module 'vue/types/vue' {
  interface Vue {
    $promptAttach(): Vue;
    $prompt(arg: PromptParams): Promise<unknown>;
    $snackbarAttach(): Vue;
    $snackbar: ((arg: SnackBarParams) => Promise<unknown>) & SnackBarMethods;
  }
}
