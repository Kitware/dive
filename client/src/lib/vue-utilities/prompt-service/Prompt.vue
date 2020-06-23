<script>
export default {
  name: 'Prompt',
  vuetify: null,
  props: {},
  data: () => ({
    show: false,
    title: '',
    text: '',
    positiveButton: 'Confirm',
    negativeButton: 'Cancel',
    selected: 'positive',
    confirm: false,
    resolve: null,
  }),
  watch: {
    show(value) {
      if (!value) {
        this.resolve(false);
      } else {
        // Needs to mount and then dialog transition, single tick doesn't work
        this.selected = 'positive';
        this.$nextTick(() => this.$nextTick(() => this.$refs.positive.$el.focus()));
      }
    },
  },
  methods: {
    negative() {
      this.show = false;
      this.resolve(false);
    },
    positive() {
      this.show = false;
      this.resolve(true);
    },
    focus(direction) {
      if (this.$refs[direction]) {
        this.$refs[direction].$el.focus();
        this.selected = direction;
      }
    },
    select() {
      if (this.selected === 'positive') {
        this.positive();
      } else {
        this.negative();
      }
    },
  },
};
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
          { bind: 'left', handler: () => focus('negative') },
          { bind: 'right', handler: () => focus('positive') },
          { bind: 'enter', handler: () => select() },
        ]"
        class="title"
      >
        {{ title }}
      </v-card-title>
      <v-card-text>
        {{ text }}
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          v-if="confirm"
          ref="negative"
          text
          @click="negative"
        >
          {{ negativeButton }}
        </v-btn>
        <v-btn
          ref="positive"
          color="primary"
          text
          @click="positive"
        >
          {{ positiveButton }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
