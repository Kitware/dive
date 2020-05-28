import Vue from 'vue';

declare module 'vue/types/vue' {
  interface Vue {
    $promptAttach(): Vue;
    $prompt(): Promise<unknown>;
    $snackbarAttach(): Vue;
    $snackbar(): Promise<unknown>;
  }
}
