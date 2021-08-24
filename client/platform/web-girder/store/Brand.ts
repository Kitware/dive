import { merge } from 'lodash';
import { Module } from 'vuex';

import { BrandData, getBrandData } from 'platform/web-girder/api/viame.service';
import defaultLogo from 'dive-common/assets/logo.png';

import { BrandState, RootState } from './types';

function setFavicon(href: string) {
  let faviconLink = document.querySelector("link[rel~='icon']");
  if (!faviconLink) {
    faviconLink = document.createElement('link');
    faviconLink.setAttribute('rel', 'icon');
    document.getElementsByTagName('head')[0].appendChild(faviconLink);
  }
  faviconLink.setAttribute('href', href);
}

function setTitle(title: string) {
  const titleEl = document.querySelector('title');
  if (titleEl) {
    titleEl.innerText = title;
  }
}

const brandModule: Module<BrandState, RootState> = {
  namespaced: true,
  state: {
    brandData: {
      vuetify: null,
      favicon: null,
      logo: defaultLogo,
      name: 'DIVE',
      loginMessage: `DIVE is automatically updated
        at 2AM EST/EDT on Thursdays. Downtime is typically
        less than 10 minutes.`,
      alertMessage: 'viame.kitware.com will be down for maintenance on 8/20/21',
    },
  },
  mutations: {
    setBrandData(state, data: BrandData) {
      state.brandData = merge(state.brandData, data);
      setTitle(state.brandData.name);
      if (state.brandData.favicon !== null) {
        setFavicon(state.brandData.favicon);
      }
    },
  },
  actions: {
    async loadBrand({ commit }) {
      commit('setBrandData', await getBrandData());
    },
  },
};

export default brandModule;
