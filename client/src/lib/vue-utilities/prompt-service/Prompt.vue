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
    confirm: false,
    resolve: null,
  }),
  watch: {
    show(value) {
      if (!value) {
        this.resolve(false);
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
          text
          @click="negative"
        >
          {{ negativeButton }}
        </v-btn>
        <v-btn
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
