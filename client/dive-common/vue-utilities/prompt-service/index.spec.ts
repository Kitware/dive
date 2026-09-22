import Vue from 'vue';
import Vuetify from 'vuetify';
import installPrompt, { usePrompt } from './index';

let state: { show: boolean; title: string; text: string; functions: { resolve: (value: boolean) => void } };
vi.mock('./Prompt.vue', () => ({
  default: {
    data() {
      state = {
        show: false, title: '', text: '', functions: { resolve: () => {} },
      };
      return state;
    },
  },
}));

it('queues failure dialogs behind an open prompt without dropping or replacing them', async () => {
  installPrompt(new Vuetify())(Vue);
  const { prompt } = usePrompt();
  const first = prompt({ title: 'Existing prompt', text: 'First' });
  const failure = prompt({ title: 'Indexing failed', text: 'No CUDA GPUs are available' });
  const another = prompt({ title: 'Another indexing failure', text: 'Missing input' });
  await Promise.resolve();
  expect(state.title).toBe('Existing prompt');
  state.show = false;
  state.functions.resolve(true);
  await first;
  await Promise.resolve();
  expect(state.title).toBe('Indexing failed');
  expect(state.text).toBe('No CUDA GPUs are available');
  state.show = false;
  state.functions.resolve(true);
  await failure;
  await Promise.resolve();
  expect(state.title).toBe('Another indexing failure');
  state.show = false;
  state.functions.resolve(true);
  await another;
});
