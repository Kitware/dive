<script>
import {
  computed, defineComponent, inject, ref, watch,
} from 'vue';
import { createLocationValidator, getLocationType } from '@girder/components';

export default defineComponent({
  inject: ['girderRest'],
  props: {
    location: {
      type: Object,
      required: true,
      validator: createLocationValidator(true),
    },
    readonly: {
      type: Boolean,
      default: false,
    },
    append: {
      type: Array,
      default: () => [],
    },
    rootLocationDisabled: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['crumbclick'],
  setup(props) {
    const girderRest = inject('girderRest');
    const loading = ref(false);
    const pathBreadcrumb = ref([]);

    const breadcrumb = computed(() => [...pathBreadcrumb.value, ...props.append]);

    function extractCrumbData(object) {
      return {
        ...object,
        type: object.type ? object.type : object._modelType,
        name: object._modelType !== 'user' ? object.name : object.login,
      };
    }

    async function computeBreadcrumb() {
      loading.value = true;
      const crumbs = [];
      const { rootLocationDisabled, location } = props;
      const { user } = girderRest;
      const type = getLocationType(location);
      const { name, _id } = location;
      if (type === 'folder') {
        if (name) {
          crumbs.unshift(extractCrumbData(location));
        } else {
          const { data } = await girderRest.get(`folder/${_id}`);
          crumbs.unshift(extractCrumbData(data));
        }
        const { data } = await girderRest.get(`folder/${_id}/rootpath_or_relative`);
        data.reverse().forEach((crumb) => {
          crumbs.unshift(extractCrumbData(crumb.object));
        });
      } else if (type === 'user' || type === 'collection') {
        const { data } = await girderRest.get(`${type}/${_id}`);
        crumbs.unshift(extractCrumbData(data));
      }
      if (!rootLocationDisabled) {
        if (
          type === 'users'
          || (user && crumbs.length && crumbs[0].type === 'user')
        ) {
          crumbs.unshift({ type: 'users' });
        }
        if (
          type === 'collections'
          || (crumbs.length && crumbs[0].type === 'collection')
        ) {
          crumbs.unshift({ type: 'collections' });
        }
        crumbs.unshift({ type: 'root' });
      }
      loading.value = false;
      pathBreadcrumb.value = crumbs;
    }

    watch(
      () => [props.location, props.rootLocationDisabled, girderRest.user],
      () => {
        computeBreadcrumb().catch(() => undefined);
      },
      { immediate: true },
    );

    return {
      girderRest,
      breadcrumb,
    };
  },
  created() {
    if (!createLocationValidator(!this.rootLocationDisabled)(this.location)) {
      throw new Error('root location cannot be used when root-location-disabled is true');
    }
  },
});
</script>

<template>
  <div class="girder-breadcrumb-component">
    <v-icon
      v-if="girderRest.user && !readonly"
      :disabled="location._id === girderRest.user._id"
      class="home-button mr-3"
      color="accent"
      icon="$userHome"
      @click="$emit('crumbclick', girderRest.user)"
    />
    <v-breadcrumbs
      :items="breadcrumb"
      class="font-weight-bold pa-0"
    >
      <template #divider>
        <span
          :disabled="readonly"
          class="subheading font-weight-bold"
        >/</span>
      </template>
      <template #item="{ item }">
        <v-breadcrumbs-item
          :disabled="(readonly || breadcrumb.indexOf(item) == breadcrumb.length - 1)"
          tag="a"
          style="cursor: pointer;"
          @click="$emit('crumbclick', item)"
        >
          <span
            v-if="['folder', 'user', 'collection'].indexOf(item.type) !== -1"
            class="text-accent"
          >{{ item.name }}</span>
          <v-icon
            v-else-if="item.type === 'users'"
            class="mdi-18px text-accent"
            icon="$user"
          />
          <v-icon
            v-else-if="item.type === 'collections'"
            class="mdi-18px text-accent"
            icon="$collection"
          />
          <v-icon
            v-else-if="item.type === 'root'"
            class="mdi-18px text-accent"
            icon="$globe"
          />
          <span v-else>{{ item }}</span>
        </v-breadcrumbs-item>
      </template>
    </v-breadcrumbs>
  </div>
</template>

<style lang="scss">
.girder-breadcrumb-component {
  display: flex;

  .v-breadcrumbs {
    .v-breadcrumbs__divider {
      padding: 0 7px;
    }

    .v-breadcrumbs__item--disabled {
      > * {
        color: inherit !important;
      }
    }

    &::after {
      content: "\00a0";
    }
  }
}
</style>
