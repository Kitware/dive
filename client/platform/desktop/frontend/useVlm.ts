import {
  inject, provide, reactive, Ref,
} from 'vue';
import type { TextQueryModelOptions, VlmModel } from 'dive-common/apispec';
import { vlmModels } from 'platform/desktop/frontend/api';

const VlmInjectKey = Symbol('vlm');
const TextQueryInjectKey = Symbol('textQuery');

export interface VlmFrameMedia {
  imagePath: string;
  frameTime?: number;
}

/**
 * Shared VLM state for a desktop viewer: the locally served vision models and
 * a resolver from frame number to the media the interactive service reads.
 */
export function createVlm(resolveFrame: (frame: number) => VlmFrameMedia | null) {
  const state = reactive({
    available: false,
    models: [] as VlmModel[],
    error: '',
  });

  async function refreshModels(): Promise<VlmModel[]> {
    try {
      const result = await vlmModels();
      state.available = result.available;
      state.models = result.models;
      state.error = result.error || '';
    } catch (err) {
      state.available = false;
      state.models = [];
      state.error = (err as Error).message;
    }
    return state.models;
  }

  return { state, refreshModels, resolveFrame };
}

export type VlmContextType = ReturnType<typeof createVlm>;

export function provideVlm(context: VlmContextType) {
  provide(VlmInjectKey, context);
}

export function useVlm(): VlmContextType | null {
  return inject<VlmContextType | null>(VlmInjectKey, null);
}

export interface TextQueryParams {
  text: string;
  boxThreshold: number;
  replaceExisting?: boolean;
  /** Unset runs SAM3 */
  vlmModel?: string;
  /** All-frames runs only; unset keeps each backend's default pipe */
  tracked?: boolean;
}

/** The viewer's text query actions, shared by the toolbar dialog and side panel. */
export interface TextQueryActions {
  sam3Installed: Readonly<Ref<boolean>>;
  running: Readonly<Ref<boolean>>;
  loadModels: () => Promise<TextQueryModelOptions>;
  runFrame: (params: TextQueryParams & { frameNum: number }) => Promise<void>;
  runAllFrames: (params: TextQueryParams) => Promise<void>;
}

export function provideTextQuery(actions: TextQueryActions) {
  provide(TextQueryInjectKey, actions);
}

export function useTextQuery(): TextQueryActions | null {
  return inject<TextQueryActions | null>(TextQueryInjectKey, null);
}
