<script lang="ts">
import {
  defineComponent,
  reactive,
  PropType,
  ref,
} from '@vue/composition-api';
import { clientSettings } from 'dive-common/store/settings';

export default defineComponent({
  name: 'TypeSettingsPanel',

  props: {
    allTypes: {
      type: Array as PropType<Array<string>>,
      required: true,
    },
  },
  setup(props, { emit }) {
    const itemHeight = 45; // in pixels
    const help = reactive({
      import: 'Import multiple Types',
      showEmptyTypes: 'View types that are not used currently.',
      lockTypes: 'Only allows the use of defined types.',
    });
    const importInstructions = ref('Please provide a list of types (separated by a new line) that you would like to import');
    const importDialog = ref(false);
    const importTypes = ref('');
    const active = ref(false);

    const confirmImport = () => {
      // Go through the importTypes and create types for importing
      const types = importTypes.value.split('\n').filter((item) => item.length);
      emit('import-types', types);
      importDialog.value = false;
      importTypes.value = '';
    };

    return {
      active,
      clientSettings,
      itemHeight,
      help,
      importInstructions,
      importDialog,
      importTypes,
      confirmImport,
    };
  },
});
</script>

<template>
  <div>
    <v-menu
      v-model="active"
      :nudge-bottom="28"
      :close-on-content-click="false"
    >
      <template #activator="{ on, attrs }">
        <v-btn
          icon
          small
          class="mx-2"
          v-bind="attrs"
          v-on="on"
        >
          <v-icon
            small
            :color="active ? 'accent' : 'default'"
          >
            mdi-cog
          </v-icon>
        </v-btn>
      </template>

      <v-card
        outlined
        class="pa-2 pr-4"
        color="blue-grey darken-3"
      >
        Type Settings
        <v-row>
          <v-col class="py-1">
            <v-btn
              dense
              small
              outlined
              hide-details
              @click="importDialog = true"
            >
              <v-icon small>
                mdi-plus
              </v-icon>
              Types
            </v-btn>
          </v-col>
          <v-col
            cols="2"
            class="py-1"
            align="right"
          >
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
        <v-row>
          <v-col class="py-1">
            <v-switch
              v-model="clientSettings.typeSettings.showEmptyTypes"
              class="my-0 ml-1 pt-0"
              dense
              label="Show Empty"
              hide-details
            />
          </v-col>
          <v-col
            cols="2"
            class="py-1"
            align="right"
          >
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
              <span>{{ help.showEmptyTypes }}</span>
            </v-tooltip>
          </v-col>
        </v-row>
        <v-row>
          <v-col class="py-1">
            <v-switch
              v-model="clientSettings.typeSettings.lockTypes"
              label="Lock Types"
              class="my-0 ml-1 pt-0"
              dense
              hide-details
            />
          </v-col>
          <v-col
            cols="2"
            class="py-1"
            align="right"
          >
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
    </v-menu>

    <v-dialog
      v-model="importDialog"
      width="350"
    >
      <div>
        <v-card>
          <v-card-title>
            Types
            <v-spacer />
            <v-btn
              icon
              small
              @click="importDialog = false"
            >
              <v-icon
                small
              >
                mdi-close
              </v-icon>
            </v-btn>
          </v-card-title>
          <v-card-text>
            {{ importInstructions }}
            <v-form>
              <v-row class="align-center">
                <v-col>
                  <v-textarea
                    v-model="importTypes"
                    outlined
                    no-resize
                    rows="10"
                  />
                </v-col>
              </v-row>
            </v-form>
            <v-alert
              text
              color="error"
            >
              Note:  You will have to check 'View Unused' in the settings to see new empty types
            </v-alert>
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
              Add
            </v-btn>
          </v-card-actions>
        </v-card>
      </div>
    </v-dialog>
  </div>
</template>
