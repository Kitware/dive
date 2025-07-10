<script>
import { createLocationValidator, getLocationType } from '@girder/components/src';

export default {
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
  data() {
    return {
      loading: false,
    };
  },
  computed: {
    // have a separate computed to prevent append triggering remote requests
    breadcrumb() {
      const { append } = this;
      return [...this.pathBreadcrumb, ...append];
    },
  },
  asyncComputed: {
    pathBreadcrumb: {
      default: [],
      async get() {
        this.loading = true;
        const breadcrumb = [];
        const { rootLocationDisabled, girderRest, location } = this;
        // The reason for this local user variable is that
        // we have to set up reactivity dependancy before the first async function call
        const { user } = girderRest;
        const type = getLocationType(location);
        const { name, _id } = location;
        if (type === 'folder') {
          // The last breadcrumb isn't returned by rootpath.
          if (name) {
            breadcrumb.unshift(this.extractCrumbData(location));
          } else {
            const { data } = await this.girderRest.get(`folder/${_id}`);
            breadcrumb.unshift(this.extractCrumbData(data));
          }
          // Get the rest of the path.
          const { data } = await this.girderRest.get(`folder/${_id}/rootpath_or_relative`);
          data.reverse().forEach((crumb) => {
            breadcrumb.unshift(this.extractCrumbData(crumb.object));
          });
        } else if (type === 'user' || type === 'collection') {
          const { data } = await this.girderRest.get(`${type}/${_id}`);
          breadcrumb.unshift(this.extractCrumbData(data));
        }
        if (!rootLocationDisabled) {
          if (
            type === 'users'
            || (user && breadcrumb.length && breadcrumb[0].type === 'user')
          ) {
            breadcrumb.unshift({ type: 'users' });
          }
          if (
            type === 'collections'
            || (breadcrumb.length && breadcrumb[0].type === 'collection')
          ) {
            breadcrumb.unshift({ type: 'collections' });
          }
          breadcrumb.unshift({ type: 'root' });
        }
        this.loading = false;
        return breadcrumb;
      },
    },
  },
  created() {
    if (!createLocationValidator(!this.rootLocationDisabled)(this.location)) {
      throw new Error('root location cannot be used when root-location-disabled is true');
    }
  },
  methods: {
    extractCrumbData(object) {
      return {
        ...object,
        type: object.type ? object.type : object._modelType,
        name: object._modelType !== 'user' ? object.name : object.login,
      };
    },
  },
};
</script>

<template>
  <div class="girder-breadcrumb-component">
    <v-icon
      v-if="girderRest.user && !readonly"
      :disabled="location._id === girderRest.user._id"
      class="home-button mr-3"
      color="accent"
      @click="$emit('crumbclick', girderRest.user)"
    >
      $vuetify.icons.userHome
    </v-icon>
    <v-breadcrumbs
      :items="breadcrumb"
      class="font-weight-bold pa-0"
    >
      <span
        slot="divider"
        :disabled="readonly"
        class="subheading font-weight-bold"
      >/</span>
      <template #item="{ item }">
        <v-breadcrumbs-item
          :disabled="(readonly || breadcrumb.indexOf(item) == breadcrumb.length - 1)"
          tag="a"
          @click="$emit('crumbclick', item)"
        >
          <template v-if="['folder', 'user', 'collection'].indexOf(item.type) !== -1">
            <span class="accent--text">{{ item.name }}</span>
          </template>
          <template v-else-if="item.type === 'users'">
            <v-icon class="mdi-18px accent--text">
              $vuetify.icons.user
            </v-icon>
          </template>
          <template v-else-if="item.type === 'collections'">
            <v-icon class="mdi-18px accent--text">
              $vuetify.icons.collection
            </v-icon>
          </template>
          <template v-else-if="item.type === 'root'">
            <v-icon class="mdi-18px accent--text">
              $vuetify.icons.globe
            </v-icon>
          </template>
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

    // Good to always hold vertical space
    &::after {
      content: "\00a0";
    }
  }
}
</style>
