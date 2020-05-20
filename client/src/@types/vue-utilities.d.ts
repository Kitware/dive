import Vue from 'vue';
declare module 'vue/types/vue' {
  interface Vue {
    $promptAttach(): Vue;
    $prompt(): Promise<any>;
    $snackbarAttach(): Vue;
    $snackbar(): Promise<any>;
  }
}
