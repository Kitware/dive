import type { App } from 'vue';

declare module 'vue' {
  interface ComponentCustomProperties {
    $promptAttach?: () => App;
  }
}
