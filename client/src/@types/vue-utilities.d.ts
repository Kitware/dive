import Vue2 from 'vue';

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
    $promptAttach(): Vue2;
    $snackbarAttach(): Vue2;
    $snackbar: ((arg: SnackBarParams) => Promise<unknown>) & SnackBarMethods;
  }
}
