<script lang="ts">
import Vue, { PropType } from 'vue';
import { Ref } from '@vue/composition-api';
import {
  EditorSettings, AnnotationTypes, AnnotationState, AnnotationDisplay,
} from '../use/useModeManager';

/**
 * This is used to control the editing and viewing of different annotation types
 */
interface EditorSettingsState {
    state?: AnnotationState;
}

export default Vue.extend({
  name: 'EditorMenu',
  props: {
    annotationModes: {
      type: Object as PropType<Ref<EditorSettings>>,
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
            text: 'Move a vertex (large circles) by clicking and dragging.  Create a new vertex by dragging and edge (small circles)',
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
      const currentStates = this.annotationModes.value.states[this.annotationModes.value.mode];
      this.annotationModes.value.display.forEach((val) => {
        obj.push({
          ...val,
          state: currentStates[val.id],
        });
      });
      return obj;
    },
    currentMode() {
      const { mode } = this.annotationModes.value;
      return mode;
    },
  },
  watch: {
    'annotationModes.value.helpMode': 'updateSnackBar',
  },
  methods: {
    updateType(id: AnnotationTypes) {
      let annotState = 'selected';
      if (this.annotationModes.value.states[this.annotationModes.value.mode][id] === 'selected') {
        annotState = 'enabled';
      }
      this.$emit('updateAnnotationMode', {
        mode: this.annotationModes.value.mode,
        type: id,
        annotState,
      });
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
      const { helpMode } = this.annotationModes.value;
      if (helpMode === 'visible') {
        this.currentHelp = this.help.visible.default.text;
        if (this.help.visible.default.display) {
          this.snackbar = true;
        }
      } else {
        //Now we calculate what is the selected mode
        const baseMode = this.help[this.annotationModes.value.helpMode];
        const states = this.annotationModes.value.states[this.annotationModes.value.mode];
        let selected = '';
        (Object.keys(states) as AnnotationTypes[]).forEach((key) => {
          if (states[key] === 'selected') {
            selected = key;
          }
        });
        if (selected !== '' && baseMode[selected]) {
          this.currentHelp = baseMode[selected].text;
          if (baseMode[selected].display) {
            this.snackbar = true;
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
    <v-btn
      icon
      :color="snackbar ? 'primary' : 'default'"
      @click="toggleHelp"
    >
      <v-icon> mdi-help</v-icon>
    </v-btn>
  </v-toolbar>
</template>
