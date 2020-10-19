<script lang="ts">
import Vue, { PropType } from 'vue';
import { cloneDeep } from 'lodash';
import { TypeSettings } from 'viame-web-common/use/useSettings';

export default Vue.extend({
  name: 'TypeSettings',

  props: {
    allTypes: {
      type: Array as PropType<Array<string>>,
      required: true,
    },
    typeSettings: {
      type: Object as PropType<TypeSettings>,
      required: true,
    },
  },

  data: () => ({
    itemHeight: 45, // in pixels
    help: {
      import: 'Import multiple Types',
      viewUnUsed: 'View types that are not used currently.',
      lockTypes: 'Only allows the use of defined types.',
    },
    importInstructions: 'Please provide a list of types (separated by a new line) that you would like to import',
    importDialog: false,
    importTypes: '',
  }),
  methods: {
    /** Reduces the number of update functions utilizing Vuex by indicating the target type */
    saveTypeSettings(event: boolean, target: 'viewUnused' | 'lockTypes') {
      const copy: TypeSettings = cloneDeep(this.typeSettings);
      copy[target] = event; // Modify the value
      this.$emit('update-type-settings', copy);
    },
    confirmImport() {
      // Go through the importTypes and create types for importing
      const types = this.importTypes.split('\n');
      this.$emit('import-types', types);
      this.importDialog = false;
    },
  },
});
</script>

<template>
  <div class="mb-2">
    <v-card
      outlined
      class="pa-2 pb-0 mt-3"
    >
      <div class="subheading">
        Type Settings
      </div>
      <v-row
        align="end"
        dense
      >
        <v-col>
          <v-btn
            class="ml-0 pa-0"
            x-small
            dense
            hide-details
            @change="importDialog = true"
          >
            Import
          </v-btn>
        </v-col>
        <v-col cols="2">
          <v-tooltip
            open-delay="200"
            bottom
            max-width="200"
          >
            <template #activator="{ on }">
              <v-icon
                small
                v-on="on"
              >
                mdi-help
              </v-icon>
            </template>
            <span>{{ help.import }}</span>
          </v-tooltip>
        </v-col>
      </v-row>
      <v-row
        align="end"
        dense
      >
        <v-col
          class="mx-2"
          cols="3"
        >
          View Unused:
        </v-col>
        <v-col>
          <v-checkbox
            v-model="typeSettings.viewUnUsed"
            class="ml-0 pa-0"
            x-small
            dense
            hide-details
            @change="saveTypeSettings($event, 'viewUnused')"
          />
        </v-col>
        <v-col cols="2">
          <v-tooltip
            open-delay="200"
            bottom
            max-width="200"
          >
            <template #activator="{ on }">
              <v-icon
                small
                v-on="on"
              >
                mdi-help
              </v-icon>
            </template>
            <span>{{ help.viewUnUsed }}</span>
          </v-tooltip>
        </v-col>
      </v-row>
      <v-row
        align="end"
        dense
      >
        <v-col
          class="mx-2"
          cols="3"
        >
          Lock Types:
        </v-col>
        <v-col>
          <v-checkbox
            :value="typeSettings.lockTypes"
            class="ml-0 pa-0"
            x-small
            dense
            hide-details
            @change="saveTypeSettings($event, 'lockTypes')"
          />
        </v-col>
        <v-col cols="2">
          <v-tooltip
            open-delay="200"
            bottom
          >
            <template #activator="{ on }">
              <v-icon
                small
                v-on="on"
              >
                mdi-help
              </v-icon>
            </template>
            <span>{{ help.lockTypes }}</span>
          </v-tooltip>
        </v-col>
      </v-row>
    </v-card>
    <v-dialog
      v-model="importDialog"
      width="350"
    >
      <div>
        <v-card>
          <v-card-title>
            Import Types
          </v-card-title>
          <v-card-subtitle class="my-0 py-0">
            <v-container class="py-0">
              <v-row>
                <v-spacer />
                <v-btn
                  icon
                  small
                  @click="importDialog = false"
                >
                  <v-icon
                    small
                  >
                    mdi-exit
                  </v-icon>
                </v-btn>
              </v-row>
            </v-container>
          </v-card-subtitle>
          <v-card-text>
            {{ importInstructions }}
            <v-form v-model="data.valid">
              <v-row class="align-center">
                <v-col>
                  <v-textarea
                    v-model="importTypes"
                    no-resize
                    rows="10"
                  />
                </v-col>
              </v-row>
            </v-form>
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn
              depressed=""
              text
              @click="importDialog = false"
            >
              Cancel
            </v-btn>
            <v-btn
              color="primary"
              depressed
              @click="confirmImport"
            >
              Import
            </v-btn>
          </v-card-actions>
        </v-card>
      </div>
    </v-dialog>
  </div>
</template>
