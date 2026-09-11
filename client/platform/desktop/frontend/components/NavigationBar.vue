<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, onMounted, ref,
} from 'vue';
import { useRouter } from 'vue-router/composables';
import JobTab from './JobTab.vue';
import AnnotationOtherMenu from './AnnotationOtherMenu.vue';
import { desktopDestinations, navigationOverflow, DesktopDestination } from './desktopNavigation';
import { lastAnnotation } from '../store/dataset';

export default defineComponent({
  components: { JobTab, AnnotationOtherMenu },
  props: { name: { type: String, default: 'DIVE' } },
  setup() {
    const router = useRouter();
    const container = ref<HTMLElement>();
    const width = ref(Infinity);
    const destinations = computed(() => {
      const items: DesktopDestination[] = desktopDestinations.filter((item) => router.getRoutes().some((route) => route.name === item.name));
      if (lastAnnotation.value) {
        items.unshift({
          name: 'viewer',
          label: 'Resume',
          icon: 'mdi-history',
          params: { id: lastAnnotation.value.id },
          title: `Resume editing ${lastAnnotation.value.name}`,
        });
      }
      return items;
    });
    const navigation = computed(() => navigationOverflow(destinations.value, width.value));
    const tabWidth = computed(() => `${Math.min(100, width.value / 4)}px`);
    let observer: ResizeObserver;
    onMounted(() => {
      if (!container.value) return;
      width.value = container.value.clientWidth;
      observer = new ResizeObserver(([entry]) => { width.value = entry.contentRect.width; });
      observer.observe(container.value);
    });
    onBeforeUnmount(() => observer?.disconnect());
    return { container, navigation, tabWidth };
  },
});
</script>

<template>
  <v-app-bar app>
    <div ref="container" class="desktop-navigation" :style="{ '--desktop-tab-width': tabWidth }">
      <v-tabs icons-and-text show-arrows="never" class="desktop-nav-tabs" color="accent">
        <template v-for="item in navigation.visible">
          <job-tab v-if="item.name === 'jobs'" :key="item.name" />
          <v-tab v-else :key="item.name" :to="{ name: item.name, params: item.params }" :title="item.title">
            {{ item.label }}<v-icon>{{ item.icon }}</v-icon>
          </v-tab>
        </template>
        <annotation-other-menu v-if="navigation.hidden.length" :destinations="navigation.hidden" />
      </v-tabs>
    </div>
  </v-app-bar>
</template>

<style lang="scss">
@import './navTabs.scss';
.desktop-navigation { flex: 1; min-width: 0; }
.desktop-navigation .v-slide-group__prev, .desktop-navigation .v-slide-group__next { display: none !important; }
.desktop-navigation .v-tab { min-width: var(--desktop-tab-width); max-width: var(--desktop-tab-width); }
</style>
