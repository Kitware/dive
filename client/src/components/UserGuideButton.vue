<script>
import ContextualHelp from '@/components/ContextualHelp.vue';

export default {
  components: {
    ContextualHelp,
  },
  data() {
    return {
      dialog: false,
    };
  },
};
</script>
<template>
  <v-dialog
    v-model="dialog"
    width="600"
  >
    <template #activator="{on}">
      <v-btn
        dense
        depressed
        target="_blank"
        color="secondary darken-2"
        class="mx-3"
        v-on="on"
      >
        User Guide
        <v-icon class="pl-2">
          mdi-help-circle
        </v-icon>
      </v-btn>
    </template>
    <v-card>
      <v-card-title>
        Help
      </v-card-title>
      <v-card-text>
        <contextual-help />
        <v-card-text>
          <v-divider />
          <v-card-actions>
            <v-spacer />
            <v-btn
              dense
              depressed
              href="https://github.com/VIAME/VIAME-Web/wiki/User-Documentation"
              target="_blank"
              color="secondary darken-2"
              class="mx-3"
            >
              User Guide
              <v-icon class="pl-2">
                mdi-help-circle
              </v-icon>
            </v-btn>
            <v-spacer />
          </v-card-actions>
        </v-card-text>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
