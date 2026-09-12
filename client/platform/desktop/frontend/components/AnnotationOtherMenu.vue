<script setup lang="ts">
import { computed, PropType } from 'vue';
import { useRouter } from 'vue-router/composables';
import { desktopDestinations, annotationPrimaryDestinations, DesktopDestination } from './desktopNavigation';

const props = defineProps({
  destinations: { type: Array as PropType<DesktopDestination[]>, default: undefined },
});
const router = useRouter();
const items = computed(() => props.destinations || desktopDestinations.filter((item) => !annotationPrimaryDestinations.includes(item.name)
  && router.getRoutes().some((route) => route.name === item.name)));
</script>

<template>
  <v-menu offset-y>
    <template #activator="{ on, attrs }">
      <button v-ripple type="button" class="v-tab annotation-other-menu" v-bind="attrs" v-on="on">
        Other
        <v-icon size="28">
          mdi-chevron-double-down
        </v-icon>
      </button>
    </template>
    <v-list dense>
      <v-list-item v-for="item in items" :key="item.name" :to="{ name: item.name, params: item.params }" :title="item.title">
        <v-list-item-icon><v-icon>{{ item.icon }}</v-icon></v-list-item-icon>
        <v-list-item-title>{{ item.label }}</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>
</template>

<style scoped>
.annotation-other-menu { min-width: var(--desktop-tab-width, 100px) !important; max-width: var(--desktop-tab-width, 100px); font-family: inherit; }
</style>
