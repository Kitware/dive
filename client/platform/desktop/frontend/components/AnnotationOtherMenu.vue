<script setup lang="ts">
import { computed, PropType } from 'vue';
import { useRouter } from 'vue-router/composables';
import { desktopDestinations, primaryDestinations, DesktopDestination } from './desktopNavigation';

const props = defineProps({
  destinations: { type: Array as PropType<DesktopDestination[]>, default: undefined },
});
const router = useRouter();
const items = computed(() => props.destinations || desktopDestinations.filter((item) => !primaryDestinations.includes(item.name)
  && router.getRoutes().some((route) => route.name === item.name)));
</script>

<template>
  <v-menu offset-y>
    <template #activator="{ on, attrs }">
      <v-btn text class="annotation-other-menu" v-bind="attrs" v-on="on">
        <span>Other</span>
        <v-icon>mdi-chevron-down</v-icon>
      </v-btn>
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
.annotation-other-menu { min-width: var(--desktop-tab-width, 100px) !important; max-width: var(--desktop-tab-width, 100px); height: 72px !important; }
.annotation-other-menu ::v-deep .v-btn__content { flex-direction: column; gap: 4px; }
</style>
