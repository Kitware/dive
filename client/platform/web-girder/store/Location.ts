import { Module } from 'vuex';
import { merge } from 'lodash';
import { GirderModel } from '@girder/components/src';
import { BrandData, getBrandData } from 'platform/web-girder/api/viame.service';
import defaultLogo from 'viame-web-common/assets/logo.png';

export interface LocationState {
  location: null | GirderModel;
  brandData: null | BrandData;
}

const locationModule: Module<LocationState, never> = {
  namespaced: true,
  state: {
    location: null,
    brandData: {
      brand: true,
      logo: defaultLogo,
      name: 'DIVE',
      loginMessage: `VIAME Web is automatically updated 
        at 2AM EST/EDT on Thursdays. Downtime is typically
        less than 10 minutes.`,
    },
  },
  mutations: {
    setLocation(state, location: GirderModel) {
      state.location = location;
    },
    setBrandData(state, data: BrandData) {
      state.brandData = merge(state.brandData, data);
    },
  },
  actions: {
    async loadBrand({ state, commit }) {
      const data = await getBrandData();
      if (data.brand) {
        commit('setBrandData', data);
      }
    },
  },
};

export default locationModule;
