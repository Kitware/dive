import Vue2 from 'vue';

declare module 'vue/types/vue' {
  interface Vue {
    $promptAttach(): Vue2;
  }
}
