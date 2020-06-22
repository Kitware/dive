import { GirderModel } from '@/lib/api/viame.service';

export interface LocationState {
    location: null | GirderModel;
}

export default {
  namespaced: true,
  state: {
    location: null,
  } as {location: null | GirderModel},
  mutations: {
    setLocation(state: { location: null | GirderModel}, location: GirderModel) {
      state.location = location;
    },
  },
};
