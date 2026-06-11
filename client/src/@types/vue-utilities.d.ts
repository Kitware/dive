import type { ComponentPublicInstance } from 'vue';

declare module '@vue/runtime-core' {
  interface ComponentCustomProperties {
    $promptAttach(): ComponentPublicInstance;
  }
}
