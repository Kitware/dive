<template>
  <v-card class="data-details">
    <v-toolbar
      flat
      density="compact"
      color="primary"
    >
      <v-toolbar-title class="text-subtitle-1">
        <v-icon class="pr-2 mdi-18px">
          {{ icon }}
        </v-icon>{{ title }}
      </v-toolbar-title>
    </v-toolbar>
    <girder-detail-list
      :rows="info"
      title="Info"
    />
    <slot name="actions" />
  </v-card>
</template>

<script>
import { defineComponent } from 'vue';
import {
  GirderDetailList,
  formatDate,
  formatSize,
  formatUsername,
} from '@girder/components';

export const DefaultInfoKeys = [
  {
    value: 'size',
    name: 'Contents: ',
    transform: formatSize,
  },
  {
    value: 'created',
    name: 'Created on ',
    transform: formatDate,
  },
  {
    value: 'public',
    name: 'Public: ',
  },
  {
    meta: true,
    value: 'fps',
    name: 'FPS: ',
  },
  {
    meta: true,
    value: 'type',
    name: 'Type: ',
  },
  {
    meta: true,
    value: 'published',
    name: 'Published: ',
  },
];

export default defineComponent({
  components: {
    GirderDetailList,
  },
  inject: ['girderRest'],
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
      details: null,
    };
  },
  watch: {
    datum: {
      immediate: true,
      async handler(datum) {
        if (datum && datum.created) {
          this.details = datum;
        } else if (datum && datum._id && datum._modelType) {
          const { data } = await this.girderRest.get(`${datum._modelType}/${datum._id}`);
          this.details = data;
        } else {
          this.details = null;
        }
      },
    },
  },
  computed: {
    title() {
      if (this.details) {
        return this.details.name || formatUsername(this.details);
      }
      if (this.datum) {
        if (this.datum._modelType) {
          return this.datum._modelType;
        }
        if (this.datum.type) {
          return this.datum.type;
        }
      }
      return `${this.value.length} Selection(s)`;
    },
    datum() {
      return this.value.length === 1 ? this.value[0] : undefined;
    },
    icon() {
      return this.datum
        ? this.$vuetify.icons.aliases[this.datum._modelType]
        : this.$vuetify.icons.aliases.fileMultiple;
    },
    info() {
      if (this.details) {
        return this.infoKeys
          .map((k) => {
            let val = k.meta
              ? this.details.meta?.[k.value]
              : this.details[k.value];
            if (!val && val !== false) {
              return null;
            }
            if (k.transform) {
              val = k.transform(val);
            }
            return `${k.name}${val}`;
          })
          .filter((v) => v);
      } if (this.value.length > 1) {
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
        const sizeMessage = `Total size: ${formatSize(typeCounts.size)}`;
        return [...countMessages, sizeMessage];
      }
      return [];
    },
  },
});
</script>

<style lang="scss">
.data-details :deep(.data-details-actions) {
  > * {
    width: 100%;
  }

  .v-btn.v-btn--disabled.v-btn--variant-flat {
    opacity: 1;
    background-color: rgb(var(--v-theme-grey-darken-2)) !important;
    color: rgb(var(--v-theme-grey)) !important;

    .v-icon {
      color: rgb(var(--v-theme-grey)) !important;
    }

    .v-btn__overlay {
      opacity: 0;
    }
  }
}
</style>
