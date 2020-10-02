<template>
  <v-snackbar
    v-model="show"
    v-bind="options"
    :timeout="timeout"
  >
    <h3
      v-if="title"
      class="mx-2"
    >
      {{ title }}:
    </h3>
    <v-spacer />
    <div>
      {{ text }}
    </div>
    <v-btn
      v-if="callback"
      color="primary"
      text
      @click="buttonClicked"
    >
      {{ button }}
    </v-btn>
  </v-snackbar>
</template>

<script>
export default {
  name: 'Snackbar',
  data: () => ({
    show: false,
    title: '',
    text: '',
    button: '',
    callback: null,
    timeout: -1,
    options: { left: true },
  }),
  methods: {
    buttonClicked() {
      this.callback();
      this.show = false;
    },
  },
};
</script>
