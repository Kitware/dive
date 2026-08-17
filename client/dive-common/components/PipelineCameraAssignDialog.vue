<script lang="ts">
import {
  computed, defineComponent, PropType, ref, watch,
} from 'vue';
import {
  CameraRole, CAMERA_ROLE_LABELS, roleOfToken,
} from 'dive-common/pipelineCameraOrder';

/**
 * One request for the user to place a dataset's cameras onto a multicam
 * pipeline's inputs. Slots come from the pipe's `# Camera Order:` header
 * (`EO`, `UV`, `IR`) or are bare `input1..N`; the proposal comes from the
 * dataset's camera roles / names and is what runs when the user confirms
 * without changes.
 */
export interface PipelineCameraAssignRequest {
  datasetName: string;
  pipelineName: string;
  slots: string[];
  cameras: string[];
  proposed: (string | null)[];
  /** Current dataset roles, shown next to each camera in the pickers. */
  roles: Record<string, CameraRole>;
}

export interface PipelineCameraAssignResult {
  order: string[];
  /** Roles to persist on the dataset (slot role -> chosen camera), when asked. */
  roles: Record<string, CameraRole> | null;
}

export default defineComponent({
  name: 'PipelineCameraAssignDialog',
  props: {
    value: {
      type: Boolean,
      default: false,
    },
    request: {
      type: Object as PropType<PipelineCameraAssignRequest | null>,
      default: null,
    },
  },
  emits: ['cancel', 'confirm'],
  setup(props, { emit }) {
    const selection = ref<(string | null)[]>([]);
    const remember = ref(true);

    watch(() => props.request, (request) => {
      selection.value = request ? [...request.proposed] : [];
      remember.value = true;
    }, { immediate: true });

    const slotRoles = computed(() => (props.request?.slots ?? []).map(roleOfToken));
    const anyRoleSlots = computed(() => slotRoles.value.some((role) => role !== null));

    function slotLabel(index: number): string {
      const slot = props.request?.slots[index] ?? '';
      const role = slotRoles.value[index];
      const roleLabel = role ? CAMERA_ROLE_LABELS[role] : slot;
      return `Camera ${index + 1} (input${index + 1}) — ${roleLabel}`;
    }

    function cameraLabel(camera: string): string {
      const role = props.request?.roles[camera];
      return role ? `${camera}  ·  ${CAMERA_ROLE_LABELS[role]}` : camera;
    }

    const problems = computed(() => {
      const chosen = selection.value;
      const issues: string[] = [];
      chosen.forEach((camera, index) => {
        if (!camera) {
          issues.push(`Camera ${index + 1} has no dataset camera assigned.`);
        }
      });
      const seen = new Map<string, number[]>();
      chosen.forEach((camera, index) => {
        if (camera) {
          seen.set(camera, [...(seen.get(camera) ?? []), index + 1]);
        }
      });
      seen.forEach((slots, camera) => {
        if (slots.length > 1) {
          issues.push(`"${camera}" is assigned to cameras ${slots.join(' and ')}.`);
        }
      });
      return issues;
    });

    const changed = computed(() => (props.request?.proposed ?? [])
      .some((camera, index) => camera !== selection.value[index]));

    function confirm() {
      if (problems.value.length || !props.request) {
        return;
      }
      const order = selection.value as string[];
      let roles: Record<string, CameraRole> | null = null;
      if (remember.value && anyRoleSlots.value) {
        roles = {};
        order.forEach((camera, index) => {
          const role = slotRoles.value[index];
          if (role) {
            roles![camera] = role;
          }
        });
      }
      emit('confirm', { order, roles } as PipelineCameraAssignResult);
    }

    return {
      selection,
      remember,
      anyRoleSlots,
      slotLabel,
      cameraLabel,
      problems,
      changed,
      confirm,
    };
  },
});
</script>

<template>
  <v-dialog
    :value="value && request !== null"
    max-width="560"
    persistent
  >
    <v-card v-if="request">
      <v-card-title class="text-h6">
        Assign cameras
      </v-card-title>
      <v-card-text>
        <p class="mb-1">
          <strong>{{ request.pipelineName }}</strong> on <strong>{{ request.datasetName }}</strong>
        </p>
        <p class="text-body-2 mb-4">
          Which dataset camera feeds each pipeline camera. Camera 1 is the frame the
          pipeline warps the other cameras' detections onto.
        </p>
        <v-select
          v-for="(slot, index) in request.slots"
          :key="slot + index"
          v-model="selection[index]"
          :items="request.cameras.map((camera) => ({ text: cameraLabel(camera), value: camera }))"
          :label="slotLabel(index)"
          outlined
          dense
          hide-details
          class="mb-3"
        />
        <v-checkbox
          v-if="anyRoleSlots"
          v-model="remember"
          dense
          hide-details
          class="mt-1"
          label="Save these as the dataset's camera roles"
        />
        <v-alert
          v-if="problems.length"
          type="warning"
          dense
          text
          class="mt-3 mb-0"
        >
          <div
            v-for="problem in problems"
            :key="problem"
          >
            {{ problem }}
          </div>
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          text
          @click="$emit('cancel')"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          :disabled="problems.length > 0"
          @click="confirm"
        >
          {{ changed ? 'Run with these cameras' : 'Run' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
