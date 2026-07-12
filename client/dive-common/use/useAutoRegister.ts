import { provide, inject, Ref } from 'vue';
import type { AutoRegisterResponse } from 'dive-common/apispec';

/**
 * Auto-register service bridge for the Camera Registration panel.
 *
 * The platform layer (desktop ViewerLoader) implements the actual call — it
 * resolves each camera's image path for the current frame and invokes the
 * interactive service. Viewer.vue provides it (wrapping in the current frame
 * number); RegistrationTools.vue injects it. On platforms without the
 * capability (web) nothing is provided and the panel hides the button.
 */
export interface AutoRegisterService {
  /**
   * Whether auto-register is usable right now. Reactive: the platform's
   * availability probe (matcher weights installed?) resolves after mount.
   */
  available: Readonly<Ref<boolean>>;
  /** Compute an alignment from camera A to camera B on the current frame. */
  run: (cameraA: string, cameraB: string) => Promise<AutoRegisterResponse>;
}

const AutoRegisterSymbol = Symbol('autoRegister');

export function provideAutoRegister(service: AutoRegisterService) {
  provide(AutoRegisterSymbol, service);
}

export function useAutoRegister(): AutoRegisterService | null {
  return inject<AutoRegisterService | null>(AutoRegisterSymbol, null);
}
