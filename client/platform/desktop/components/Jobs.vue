<script lang="ts">
import moment, { utc } from 'moment';
import { defineComponent, ref, onBeforeUnmount } from '@vue/composition-api';
import BrowserLink from './BrowserLink.vue';
import NavigationBar from './NavigationBar.vue';

import { recentHistory } from '../store/jobs';

export default defineComponent({
  components: {
    BrowserLink,
    NavigationBar,
  },
  setup() {
    const visibleOutput = ref(null as string | null);

    /* clockDriver causes the page to re-render every second */
    const clockDriver = ref(0);
    const clockDriverInterval = setInterval(() => {
      clockDriver.value += 1;
    }, 1000);
    onBeforeUnmount(() => clearInterval(clockDriverInterval));

    return {
      clockDriver,
      recentHistory,
      moment,
      utc,
      visibleOutput,
    };
  },
});
</script>

<template>
  <v-main>
    <navigation-bar />
    <v-container>
      <v-col>
        <v-row>
          <span style="display: none;">{{ clockDriver }}</span>
          <v-col>
            <h1 class="text-h4 mb-4 font-weight-light">
              Job History ({{ recentHistory.length }})
            </h1>
            <v-card
              v-for="job in recentHistory"
              :key="job.job.key"
              class=" mb-4"
              min-width="100%"
            >
              <v-progress-linear
                :color="job.job.exitCode === 0 ? 'success' : 'primary'"
                :indeterminate="job.job.exitCode === null"
                :value="100"
              />
              <v-row
                no-gutters
                class="pt-3"
              >
                <v-col cols="1">
                  <div class="mt-2 d-flex flex-row justify-center">
                    <v-icon
                      v-if="job.job.exitCode === null"
                    >
                      mdi-spin mdi-sync
                    </v-icon>
                    <v-icon
                      v-else-if="job.job.exitCode === 0"
                      color="success"
                    >
                      mdi-check-circle
                    </v-icon>
                    <v-icon
                      v-else
                      color="error"
                    >
                      mdi-close
                    </v-icon>
                  </div>
                </v-col>
                <v-col cols="8">
                  <v-card-title class="primary--text text--lighten-3 text-decoration-none pt-0">
                    {{ job.datasets[0].meta.name }}
                  </v-card-title>
                  <v-card-subtitle>
                    [pipe] {{ job.job.pipeline.name }}
                    <br>[pid] {{ job.job.pid }}
                    <br>[path] {{ job.datasets[0].meta.originalBasePath }}
                  </v-card-subtitle>
                </v-col>
                <v-col cols="3">
                  <div class="ma-3">
                    <v-icon class="pr-2">
                      mdi-calendar
                    </v-icon>
                    {{ moment(job.job.startTime).fromNow() }}
                  </div>
                  <div
                    class="ma-3 pr-2"
                  >
                    <v-icon class="pr-2">
                      mdi-timer
                    </v-icon>
                    <span>
                      {{
                        utc(
                          moment(job.job.endTime || moment())
                            .diff(moment(job.job.startTime))
                        )
                          .format("HH:mm:ss")
                      }}
                    </span>
                  </div>
                  <v-btn
                    text
                    small
                    class="mb-2 primary--text text--lighten-3 text-decoration-none"
                    @click="visibleOutput = job.job.key"
                  >
                    <v-icon
                      color="primary lighten-3"
                      class="pr-2"
                    >
                      mdi-console
                    </v-icon> View Output
                  </v-btn>
                </v-col>
              </v-row>
              <v-row
                v-if="visibleOutput === job.job.key"
                class="pa-3"
                no-gutters
              >
                <v-card
                  flat
                  rounded
                  color="black"
                  min-width="100%"
                  class="px-4 py-1"
                >
                  <p
                    v-for="(line, i) in job.logs.slice(-10, -1)"
                    :key="line + i"
                    class="my-1 terminal"
                  >
                    {{ line.replace('\n', '') }}
                  </p>
                </v-card>
              </v-row>
            </v-card>
          </v-col>
        </v-row>
      </v-col>
    </v-container>
  </v-main>
</template>

<style scoped>
.terminal {
  font-family: monospace;
  font-size: 12px;
}
</style>
