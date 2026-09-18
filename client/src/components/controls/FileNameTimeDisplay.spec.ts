// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- vue-test-utils typing of defineComponent */
import { ref, shallowRef } from 'vue';
import { mount } from '@vue/test-utils';
import FileNameTimeDisplay from './FileNameTimeDisplay.vue';

const selectedCamera = ref('left');
const cameras = ref(['left', 'right']);
const controllers = {
  left: { filename: ref('f0028.jpg'), duration: ref(0) },
  right: { filename: ref('f0028.jpg'), duration: ref(0) },
};
vi.mock('../../provides', () => ({ useSelectedCamera: () => selectedCamera }));
vi.mock('../annotators/useMediaController', () => ({
  injectAggregateController: () => shallowRef({
    currentTime: ref(0),
    frame: ref(0),
    cameras,
    getController: (camera: string) => controllers[camera as 'left' | 'right'],
  }),
}));

it('shows the selected camera filename', async () => {
  const wrapper = mount(FileNameTimeDisplay as any, { propsData: { displayType: 'filename' } });
  expect(wrapper.text()).toContain('f0028.jpg');
  selectedCamera.value = 'right';
  controllers.right.filename.value = 'f0029.jpg';
  await wrapper.vm.$nextTick();
  expect(wrapper.text()).toContain('f0029.jpg');
  expect(wrapper.text()).not.toContain('f0028.jpg');
});
