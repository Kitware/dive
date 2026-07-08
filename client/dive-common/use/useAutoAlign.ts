import { provide, inject, Ref } from 'vue';
import type { AutoAlignResponse } from 'dive-common/apispec';

/**
 * Auto-align service bridge for the Camera Registration panel.
 *
 * The platform layer (desktop ViewerLoader) implements the actual call — it
 * resolves each camera's image path for the current frame and invokes the
 * interactive service. Viewer.vue provides it (wrapping in the current frame
 * number); RegistrationTools.vue injects it. On platforms without the
 * capability (web) nothing is provided and the panel hides the button.
 */
export interface AutoAlignService {
  /**
   * Whether auto-align is usable right now. Reactive: the platform's
   * availability probe (matcher weights installed?) resolves after mount.
   */
  available: Readonly<Ref<boolean>>;
  /** Compute an alignment from camera A to camera B on the current frame. */
  run: (cameraA: string, cameraB: string) => Promise<AutoAlignResponse>;
}

const AutoAlignSymbol = Symbol('autoAlign');

export function provideAutoAlign(service: AutoAlignService) {
  provide(AutoAlignSymbol, service);
}

export function useAutoAlign(): AutoAlignService | null {
  return inject<AutoAlignService | null>(AutoAlignSymbol, null);
}
