<script lang="ts">
import {
  computed, defineComponent, ref, watch,
} from 'vue';
import {
  useAttributes,
  useCameraStore,
  useHandler,
  useReadOnlyMode,
  useSelectedCamera,
  useSelectedTrackId,
  useTime,
} from 'vue-media-annotator/provides';
import type { Attribute } from 'vue-media-annotator/use/AttributeTypes';
import type { VlmChatTurn, VlmImageSpec } from 'dive-common/apispec';
import { vlmAsk } from 'platform/desktop/frontend/api';
import { useVlm } from 'platform/desktop/frontend/useVlm';

type Scope = 'frame' | 'track' | 'trackFrames';

interface Turn extends VlmChatTurn {
  /** What the question was asked about, e.g. "Track 3 @ frame 12" */
  subject?: string;
  trackId?: number;
  frame?: number;
  /** Answer spans several frames, so it can only be saved on the track */
  multiFrame?: boolean;
  savedAs?: string;
}

const SAMPLED_FRAME_COUNT = 4;

export default defineComponent({
  name: 'VlmAskContext',
  props: {
    model: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    const vlm = useVlm();
    const { frame } = useTime();
    const selectedTrackId = useSelectedTrackId();
    const selectedCamera = useSelectedCamera();
    const cameraStore = useCameraStore();
    const attributes = useAttributes();
    const handler = useHandler();
    const readOnlyMode = useReadOnlyMode();

    const scope = ref<Scope>('frame');
    const think = ref(false);
    const question = ref('');
    const turns = ref<Turn[]>([]);
    const busy = ref(false);
    const error = ref('');
    const attributeName = ref('vlm_answer');
    const attributeTarget = ref<'track' | 'detection'>('track');

    const modelInfo = computed(() => vlm?.state.models.find((m) => m.name === props.model));

    const selectedTrack = computed(() => {
      if (selectedTrackId.value === null) return null;
      try {
        return cameraStore.getTrack(selectedTrackId.value, selectedCamera.value);
      } catch {
        return null;
      }
    });

    function trackBox(frameNum: number): [number, number, number, number] | null {
      const [real] = selectedTrack.value?.getFeature(frameNum) ?? [];
      return real?.bounds ? [...real.bounds] as [number, number, number, number] : null;
    }

    const scopeItems = computed(() => [
      { text: 'Current frame', value: 'frame' },
      { text: 'Selected track (this frame)', value: 'track', disabled: !trackBox(frame.value) },
      { text: `Selected track (${SAMPLED_FRAME_COUNT} sampled frames)`, value: 'trackFrames', disabled: !selectedTrack.value },
    ]);

    watch(scopeItems, (items) => {
      if (items.find((item) => item.value === scope.value)?.disabled) {
        scope.value = 'frame';
      }
    });

    function sampledTrackFrames(): number[] {
      const frames = (selectedTrack.value?.featureIndex ?? []).filter((f) => trackBox(f));
      if (frames.length <= SAMPLED_FRAME_COUNT) return frames;
      const step = (frames.length - 1) / (SAMPLED_FRAME_COUNT - 1);
      return Array.from({ length: SAMPLED_FRAME_COUNT }, (_, i) => frames[Math.round(i * step)]);
    }

    function buildRequest(): { images: VlmImageSpec[]; turn: Partial<Turn> } {
      if (!vlm) throw new Error('Vision model queries are unavailable for this dataset.');
      const media = (frameNum: number) => {
        const resolved = vlm.resolveFrame(frameNum);
        if (!resolved) throw new Error(`Could not resolve the image for frame ${frameNum}.`);
        return resolved;
      };
      const trackId = selectedTrackId.value ?? undefined;
      if (scope.value === 'track') {
        return {
          images: [{ ...media(frame.value), box: trackBox(frame.value) ?? undefined }],
          turn: {
            subject: `Track ${trackId} @ frame ${frame.value}`, trackId, frame: frame.value,
          },
        };
      }
      if (scope.value === 'trackFrames') {
        const frames = sampledTrackFrames();
        return {
          images: frames.map((f) => ({ ...media(f), box: trackBox(f) ?? undefined })),
          turn: {
            subject: `Track ${trackId} (frames ${frames.join(', ')})`, trackId, multiFrame: true,
          },
        };
      }
      return {
        images: [media(frame.value)],
        turn: { subject: `Frame ${frame.value}`, frame: frame.value },
      };
    }

    async function ask() {
      const text = question.value.trim();
      if (!text || busy.value) return;
      error.value = '';
      busy.value = true;
      const history = turns.value.map(({ role, content }) => ({ role, content }));
      try {
        const { images, turn } = buildRequest();
        turns.value.push({ role: 'user', content: text, ...turn });
        question.value = '';
        const response = await vlmAsk({
          model: props.model,
          think: modelInfo.value?.thinking ? think.value : undefined,
          question: text,
          images,
          history,
        });
        if (!response.success) throw new Error(response.error || 'Query failed');
        turns.value.push({ role: 'assistant', content: response.answer || '', ...turn });
      } catch (err) {
        turns.value.splice(history.length);
        question.value = text;
        error.value = (err as Error).message;
      } finally {
        busy.value = false;
      }
    }

    function clear() {
      turns.value = [];
      error.value = '';
    }

    function canSave(turn: Turn) {
      return !readOnlyMode.value && turn.trackId !== undefined
        && (attributeTarget.value === 'track' || !turn.multiFrame);
    }

    function saveAnswer(turn: Turn) {
      const name = attributeName.value.trim();
      if (!name || turn.trackId === undefined) return;
      const belongs = attributeTarget.value;
      const key = `${belongs}_${name}`;
      error.value = '';
      try {
        if (!attributes.value.some((a: Attribute) => a.key === key)) {
          handler.setAttribute({
            data: {
              belongs, datatype: 'text', name, key,
            },
          });
        }
        if (belongs === 'track') {
          cameraStore.setTrackAttribute(turn.trackId, name, turn.content);
        } else {
          cameraStore.setTrackFeatureAttribute(turn.trackId, turn.frame as number, name, turn.content);
        }
        // eslint-disable-next-line no-param-reassign
        turn.savedAs = `${belongs} attribute "${name}"`;
      } catch (err) {
        error.value = (err as Error).message;
      }
    }

    return {
      vlm,
      modelInfo,
      scope,
      scopeItems,
      think,
      question,
      turns,
      busy,
      error,
      attributeName,
      attributeTarget,
      ask,
      clear,
      canSave,
      saveAnswer,
    };
  },
});
</script>

<template>
  <div class="vlm-ask-context">
    <v-alert
      v-if="!vlm"
      type="info"
      dense
      text
    >
      Vision model queries are unavailable for this dataset.
    </v-alert>
    <div v-else>
      <v-select
        v-model="scope"
        :items="scopeItems"
        :disabled="busy"
        label="Ask about"
        dense
        outlined
        hide-details
        class="mb-1"
      />
      <v-checkbox
        v-if="modelInfo && modelInfo.thinking"
        v-model="think"
        label="Extra thinking before answering (slower)"
        dense
        hide-details
        class="mt-1 mb-2"
      />

      <div class="vlm-turns my-2">
        <div
          v-for="(turn, i) in turns"
          :key="i"
          :class="['vlm-turn', 'pa-2', 'mb-2', turn.role === 'user' ? 'vlm-turn--user' : 'vlm-turn--answer']"
        >
          <div
            v-if="turn.role === 'user'"
            class="text-caption text--secondary"
          >
            {{ turn.subject }}
          </div>
          <div class="vlm-turn__text text-body-2">
            {{ turn.content }}
          </div>
          <div
            v-if="turn.role === 'assistant'"
            class="mt-1"
          >
            <span
              v-if="turn.savedAs"
              class="text-caption success--text"
            >
              Saved as {{ turn.savedAs }}
            </span>
            <v-btn
              v-else-if="canSave(turn)"
              x-small
              text
              color="primary"
              class="px-1"
              @click="saveAnswer(turn)"
            >
              Save to track {{ turn.trackId }}
            </v-btn>
          </div>
        </div>
      </div>

      <v-textarea
        v-model="question"
        :disabled="busy"
        label="Question"
        placeholder="e.g., What species is this? Is it tagged?"
        rows="2"
        auto-grow
        dense
        outlined
        hide-details
        @keydown.enter.exact.prevent="ask"
      />
      <div class="d-flex align-center mt-2">
        <v-btn
          small
          text
          :disabled="busy || !turns.length"
          @click="clear"
        >
          Clear
        </v-btn>
        <v-spacer />
        <v-btn
          small
          color="primary"
          :loading="busy"
          :disabled="!question.trim()"
          @click="ask"
        >
          Ask
        </v-btn>
      </div>
      <v-alert
        v-if="error"
        type="error"
        dense
        text
        class="text-caption mt-2"
      >
        {{ error }}
      </v-alert>

      <v-divider class="my-3" />
      <div class="text-subtitle-2 mb-1">
        Save answers as
      </div>
      <div class="d-flex">
        <v-text-field
          v-model="attributeName"
          label="Attribute name"
          dense
          outlined
          hide-details
          class="mr-2"
        />
        <v-select
          v-model="attributeTarget"
          :items="[{ text: 'Track', value: 'track' }, { text: 'Detection', value: 'detection' }]"
          dense
          outlined
          hide-details
          style="max-width: 120px"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.vlm-turn {
  border-radius: 4px;
}
.vlm-turn--user {
  background-color: rgba(255, 255, 255, 0.06);
}
.vlm-turn--answer {
  border-left: 3px solid var(--v-primary-base);
}
.vlm-turn__text {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
