<script lang="ts">
import {
  computed, defineComponent, PropType, Ref, ref,
} from '@vue/composition-api';

import { Attribute } from 'viame-web-common/apispec';

export default defineComponent({
  name: 'AttributeSettings',
  props: {
    selectedAttribute: {
      type: Object as PropType<Attribute>,
      required: true,
    },
    error: {
      type: String,
      default: '',
    },
  },
  setup(props, { root, emit }) {
    const name: Ref<string> = ref(props.selectedAttribute.name);
    const belongs: Ref<string> = ref(props.selectedAttribute.belongs);
    const datatype: Ref<string> = ref(props.selectedAttribute.datatype);
    let values: string[] = props.selectedAttribute.values ? props.selectedAttribute.values : [];
    let addNew = !props.selectedAttribute._id.length;

    const form: Ref<HTMLFormElement | null> = ref(null);

    const textValues = computed({
      get: () => {
        if (values) {
          return values.join('\n');
        }
        return '';
      },
      set: (newval) => {
        values = newval.split('\n');
      },

    });

    function setDefaultValue() {
      name.value = '';
      belongs.value = 'track';
      datatype.value = 'number';
      values = [];
    }
    function add() {
      setDefaultValue();
      addNew = true;
      if (form.value) {
        form.value.resetValidation();
      }
    }

    async function submit() {
      if (form.value && !form.value.validate()) {
        return;
      }

      const content = {
        name: name.value,
        belongs: belongs.value,
        datatype: datatype.value,
        values: datatype.value === 'text' && values ? values : [],
        _id: props.selectedAttribute._id,
      };

      emit('save', { addNew, data: content });
    }

    async function deleteAttribute() {
      const result = await root.$prompt({
        title: 'Confirm',
        text: 'Do you want to delete this attribute?',
        confirm: true,
      });
      if (!result) {
        return;
      }
      emit('delete', props.selectedAttribute);
    }
    return {
      name,
      belongs,
      datatype,
      values,
      addNew,
      //computed
      textValues,
      //functions
      add,
      submit,
      deleteAttribute,
    };
  },
});
</script>

<template>
  <v-card class="attribute-settings">
    <v-card-title class="pb-0">
      Attributes
      <v-card-text>
        <v-alert
          v-if="error || !addNew"
          :type="error ? 'error' : 'info'"
        >
          <div style="word-break: break-word;">
            {{
              error ? error :
              'Changes to Attribute Datatypes or Names do not effect \
               currently set attributes on tracks.'
            }}
          </div>
        </v-alert>
        <v-form ref="form">
          <v-text-field
            v-model="name"
            label="Name"
            :rules="[v => !!v || 'Name is required', v => !v.includes(' ') || 'No spaces']"
            required
          />
          <v-select
            v-model="datatype"
            style="max-width: 220px;"
            :items="[
              { text: 'Boolean', value: 'boolean' },
              { text: 'Number', value: 'number' },
              { text: 'Text', value: 'text' }
            ]"
            label="Datatype"
          />
          <v-textarea
            v-if="datatype === 'text'"
            v-model="textValues"
            style="max-width: 250px;"
            label="Predefined values"
            hint="Line separated values"
            outlined
            auto-grow
            row-height="30"
          />
        </v-form>
        <v-card-actions>
          <v-row>
            <v-tooltip
              open-delay="100"
              bottom
            >
              <template #activator="{ on }">
                <div v-on="on">
                  <v-btn
                    class="hover-show-child"
                    color="error"
                    :disabled="!selectedAttribute._id.length"
                    @click.prevent="deleteAttribute"
                  >
                    Delete
                  </v-btn>
                </div>
              </template>
              <span
                class="ma-0 pa-1"
              >
                Deletion of Attribute
              </span>
            </v-tooltip>
            <v-spacer />
            <v-btn
              text
              class="mr-2"
              @click="$emit('close')"
            >
              Cancel
            </v-btn>
            <v-btn
              color="primary"
              :disabled="!name || name.includes(' ')"
              @click.prevent="submit"
            >
              Save
            </v-btn>
          </v-row>
        </v-card-actions>
      </v-card-text>
    </v-card-title>
  </v-card>
</template>

<style lang="scss">
.attribute-settings {
  .v-textarea textarea {
    line-height: 24px;
  }
}
</style>
