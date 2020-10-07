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
  title?: string;
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
    $prompt: {
      (arg: PromptParams): Promise<boolean>;
      visible: () => boolean;
      hide: () => void;
    };
    $snackbarAttach(): Vue;
    $snackbar: ((arg: SnackBarParams) => Promise<unknown>) & SnackBarMethods;
  }
}
