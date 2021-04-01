<template>
  <v-card class="data-details">
    <v-toolbar
      flat="flat"
      dark="dark"
      dense="dense"
      color="primary"
    >
      <v-toolbar-title class="subtitle-1">
        <v-icon class="pr-2 mdi-18px">
          {{ icon }}
        </v-icon>{{ title }}
      </v-toolbar-title>
    </v-toolbar>
    <girder-markdown
      v-if="details && details.description"
      :text="details.description"
      class="mx-3 mt-2"
    />
    <girder-detail-list
      :rows="info"
      title="Info"
    />
    <slot name="actions" />
  </v-card>
</template>

<script>
import Vue from 'vue';
import {
  GirderDetailList,
  GirderMarkdown,
  mixins,
} from '@girder/components/src';

const {
  dateFormatter,
  sizeFormatter,
  usernameFormatter,
} = mixins;

/**
 * @type {Array<{
 *  value: String,
 *  name: String,
 *  transform: Function
 * }>}
 */
export const DefaultInfoKeys = [
  {
    value: 'size',
    name: 'Size: ',
    transform: sizeFormatter.methods.formatSize,
  },
  {
    value: 'created',
    name: 'Created on ',
    transform: dateFormatter.methods.formatDate,
  },
];

export default Vue.extend({
  components: {
    GirderDetailList,
    GirderMarkdown,
  },
  mixins: [sizeFormatter, usernameFormatter],
  props: {
    value: {
      required: true,
      type: Array,
    },
    infoKeys: {
      type: Array,
      default: () => DefaultInfoKeys,
    },
  },
  data() {
    return {
      showUpsert: false,
    };
  },
  inject: ['girderRest'],
  asyncComputed: {
    async details() {
      if (this.datum && this.datum.created) {
        return this.datum;
      } if (this.datum && this.datum._id && this.datum._modelType) {
        const { data } = await this.girderRest.get(`${this.datum._modelType}/${this.datum._id}`);
        return data;
      }
      return null;
    },
  },
  computed: {
    title() {
      return this.details
        ? (this.details.name || this.formatUsername(this.details))
        : `${this.value.length} Selection(s)`;
    },
    datum() {
      return this.value.length === 1 ? this.value[0] : undefined;
    },
    icon() {
      return this.datum
        ? this.$vuetify.icons.values[this.datum._modelType]
        : this.$vuetify.icons.values.fileMultiple;
    },
    info() {
      if (this.details) {
        /* If this is a single datum */
        return this.infoKeys.map((k) => {
          let val = this.details[k.value];
          if (k.transform) {
            val = k.transform(val);
          }
          return `${k.name}${val}`;
        });
      } if (this.value.length > 1) {
        /* If this is a multi-selection */
        const reducer = (acc, curr) => {
          acc[curr._modelType] += 1;
          acc.size += curr.size;
          return acc;
        };
        const typeCounts = this.value.reduce(reducer, {
          item: 0,
          folder: 0,
          size: 0,
        });
        const countMessages = ['item', 'folder']
          .filter((k) => typeCounts[k] > 0)
          .map((k) => `${typeCounts[k]} ${k}(s) selected`);
        const sizeMessage = `Total size: ${this.formatSize(typeCounts.size)}`;
        return [...countMessages, sizeMessage];
      }
      return [];
    },
  },
});
</script>
