<script lang="ts">
import Vue, { PropType } from 'vue';
import {
  EditorSettings, AnnotationTypes, AnnotationState, AnnotationDisplay,
} from '../use/useAnnotationMode';

/**
 * This is used to control the editing and viewing of different annotation types
 */
interface EditorSettingsState {
    state?: AnnotationState;
}

interface AnnotationHelp {
  display: boolean;
  text: string;
}

export default Vue.extend({
  name: 'EditorMenu',
  props: {
    annotationModes: {
      type: Object as PropType<EditorSettings>,
      required: true,
    },
  },
  data() {
    return {
      snackbar: false,
      timeout: 4000,
      currentHelp: '',
      help: {
        visible: {
          default: {
            display: false,
            text: 'Toggle the different modes to turn items on and off the screen',
          },
        },
        editing: {
          rectangle: {
            display: true,
            text: 'Click and drag a corner to resize the rectangle.  Click off the rectangle to exit editing mode',
          },
          polygon: {
            display: true,
            text: 'Move a vertex (large circles) by clicking and dragging.  Create a new vertex by dragging an edge (small circles)',
          },
        },
        creation: {
          rectangle: {
            display: true,
            text: 'Click and drag to create a rectangle.  The rectangle will be created when the left mouse button is released.  Press Escape or Right Click to cancel',
          },
          polygon: {
            display: true,
            text: 'Click onces to start and continue clicking to generate new vertices.  Either connect the line to the beginning, Double Click or Right Click.  Escape will cancel creation',
          },
        },

      },
    };
  },
  computed: {
    options() {
      const obj: AnnotationDisplay[] = [];
      const currentStates = this.annotationModes.states.value[this.annotationModes.mode.value];
      this.annotationModes.display.value.forEach((val) => {
        obj.push({
          ...val,
          state: currentStates[val.id],
        });
      });
      return obj;
    },
    selectedIndex() {
      return this.annotationModes.selectedIndex.value;
    },
    currentMode() {
      const mode = this.annotationModes.mode.value;
      return mode;
    },
  },
  watch: {
    'annotationModes.helpMode.value': 'updateSnackBar',
  },
  methods: {
    updateType(id: AnnotationTypes) {
      let annotState = 'selected';
      if (this.annotationModes.states.value[this.annotationModes.mode.value][id] === 'selected') {
        annotState = 'enabled';
      }
      this.$emit('updateAnnotationMode', {
        mode: this.annotationModes.mode.value,
        type: id,
        annotState,
      });
    },
    deletePoint() {
      this.$emit('delete-point');
    },
    toggleHelp() {
      if (this.snackbar) {
        this.snackbar = false;
      } else {
        this.snackbar = true;
        this.updateSnackBar();
      }
    },
    updateSnackBar() {
      //We need to calculate which help to display
      if (!this.snackbar) {
        return;
      }
      const helpMode = this.annotationModes.helpMode.value;
      if (helpMode === 'visible') {
        this.currentHelp = this.help.visible.default.text;
        if (this.help.visible.default.display) {
          this.snackbar = true;
        }
      } else {
        //Now we calculate what is the selected mode
        const baseMode = this.help[this.annotationModes.helpMode.value];
        const states = this.annotationModes.states.value[this.annotationModes.mode.value];
        let selected: AnnotationTypes | '' = '';
        (Object.keys(states) as AnnotationTypes[]).forEach((key) => {
          if (states[key] === 'selected') {
            selected = key;
          }
        });
        if (selected !== '') {
          const selectedBaseMode: AnnotationHelp = baseMode[selected];
          if (selectedBaseMode) {
            this.currentHelp = selectedBaseMode.text;
            if (selectedBaseMode.display) {
              this.snackbar = true;
            }
          }
        }
      }
      this.$snackbar.setOptions({
        bottom: false, top: true, right: true, app: true,
      });

      if (this.snackbar) {
        this.$snackbar({
          text: this.currentHelp,
          button: 'Disable Help',
          timeout: 6000,
          immediate: true,
          callback: () => {
            this.snackbar = false;
          },
        });
      }
    },
  },

});
</script>

<template>
  <v-toolbar dense>
    <v-toolbar-title>{{ currentMode }}:</v-toolbar-title>
    <span
      v-for="(item, index) in options"
      :key="index"
    >
      <v-tooltip
        bottom
        open-delay="100"
      >
        <template #activator="{ on }">
          <v-btn
            :color="currentMode === 'visible' ? 'primary' : 'error'"
            class="mx-1"
            :outlined="item.state === 'enabled'"
            :disabled="item.state === 'disabled'"
            v-on="on"
            @click="updateType(item.id)"
          >
            <v-icon>{{ item.icon }}</v-icon>
          </v-btn>
        </template>
        <span>{{ item.title }}</span>
      </v-tooltip>
    </span>
    <v-spacer />
    <span v-if="selectedIndex !== -1 && currentMode === 'editing'">
      <v-tooltip
        bottom
        open-delay="100"
      >
        <template #activator="{ on }">
          <v-btn
            :color="'error'"
            class="mx-1"
            v-on="on"
            @click="deletePoint()"
          >
            <v-icon>mdi-delete</v-icon>
            point
          </v-btn>
        </template>
        <span>Remove Point</span>
      </v-tooltip>

    </span>
    <v-spacer />
    <v-btn
      icon
      :color="snackbar ? 'primary' : 'default'"
      @click="toggleHelp"
    >
      <v-icon> mdi-help</v-icon>
    </v-btn>
  </v-toolbar>
</template>
