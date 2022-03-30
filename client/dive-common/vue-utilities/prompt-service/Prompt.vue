<script lang="ts">
import {
  ref, Ref, watch, nextTick, defineComponent,
} from '@vue/composition-api';

export default defineComponent({
  name: 'Prompt',
  props: {},
  setup() {
    const show = ref(false);
    const title = ref('');
    const text: Ref<string | string[]> = ref('');
    const positiveButton = ref('Confirm');
    const negativeButton = ref('Cancel');
    const selected = ref('positive');
    const confirm = ref(false);

    /**
     * Placeholder resolver function.  Wrapped in object so that
     * its reference isn't changed on reassign.
     */
    const functions = {
      resolve(val: boolean) {
        return val;
      },
    };

    const positive: Ref<HTMLFormElement | null> = ref(null);
    const negative: Ref<HTMLFormElement | null> = ref(null);

    async function clickPositive() {
      show.value = false;
      functions.resolve(true);
    }

    async function clickNegative() {
      show.value = false;
      functions.resolve(false);
    }

    async function select() {
      if (selected.value === 'positive') {
        clickPositive();
      } else {
        clickNegative();
      }
    }

    async function focusPositive() {
      if (positive.value) {
        // vuetify 2 hack: need to add extra .$el property, may be removed in vuetify 3
        positive.value.$el.focus();
        selected.value = 'positive';
      }
    }

    async function focusNegative() {
      if (negative.value) {
        // vuetify 2 hack: need to add extra .$el property, may be removed in vuetify 3
        negative.value.$el.focus();
        selected.value = 'negative';
      }
    }

    watch(show, async (value) => {
      if (!value) {
        functions.resolve(false);
      } else if (positive.value) {
        selected.value = 'positive';
        // Needs to mount and then dialog transition, single tick doesn't work
        await nextTick();
        await nextTick();
        // vuetify 2 hack: need to add extra .$el property, may be removed in vuetify 3
        positive.value.$el.focus();
      }
    });

    return {
      show,
      title,
      text,
      positiveButton,
      negativeButton,
      selected,
      confirm,
      functions,
      clickPositive,
      clickNegative,
      select,
      positive,
      negative,
      focusPositive,
      focusNegative,
    };
  },
});
</script>

<template>
  <v-dialog
    v-model="show"
    max-width="400"
  >
    <v-card>
      <v-card-title
        v-if="title"
        v-mousetrap="[
          { bind: 'left', handler: () => focusNegative(), disable: !show },
          { bind: 'right', handler: () => focusPositive(), disable: !show },
          { bind: 'enter', handler: () => select(), disable: !show },
        ]"
        class="title"
      >
        {{ title }}
      </v-card-title>
      <v-card-text v-if="Array.isArray(text)">
        <div
          v-for="(item,key) in text"
          :key="key"
        >
          {{ item }}
        </div>
      </v-card-text>
      <v-card-text v-else>
        {{ text }}
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          v-if="confirm && negativeButton && negativeButton.length"
          ref="negative"
          text
          @click="clickNegative"
        >
          {{ negativeButton }}
        </v-btn>
        <v-btn
          ref="positive"
          color="primary"
          text
          @click="clickPositive"
        >
          {{ positiveButton }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
