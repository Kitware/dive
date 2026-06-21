/* eslint-disable import/prefer-default-export -- singleton composable store */
import { ref } from 'vue';
import { merge } from 'lodash';

import type { BrandData } from 'platform/web-girder/api';
import { getBrandData as fetchBrandData } from 'platform/web-girder/api';
import defaultLogo from 'dive-common/assets/logo.png';

function setFavicon(href: string) {
  let faviconLink = document.querySelector("link[rel~='icon']");
  if (!faviconLink) {
    faviconLink = document.createElement('link');
    faviconLink.setAttribute('rel', 'icon');
    document.getElementsByTagName('head')[0].appendChild(faviconLink);
  }
  faviconLink.setAttribute('href', href);
}

function setTitle(title?: string) {
  const titleEl = document.querySelector('title');
  if (titleEl && title !== undefined) {
    titleEl.innerText = title;
  }
}

const defaultBrandData: BrandData = {
  vuetify: null,
  favicon: undefined,
  logo: defaultLogo,
  name: 'DIVE',
  loginMessage: `DIVE is automatically updated
        at 2AM EST/EDT on Thursdays. Downtime is typically
        less than 10 minutes.`,
  alertMessage: '',
  trainingMessage: `Training Jobs depending on the configuration and the size/number of datasets can
       take a long time to complete.`,
};

const brandData = ref<BrandData>({ ...defaultBrandData });

function applyBrandSideEffects(data: BrandData) {
  setTitle(data.name);
  if (data.favicon) {
    setFavicon(data.favicon);
  }
}

export function useBrand() {
  function getBrandData(): BrandData {
    return brandData.value;
  }

  function setBrandData(data: Partial<BrandData>) {
    brandData.value = merge({}, brandData.value, data);
    applyBrandSideEffects(brandData.value);
  }

  async function loadBrand(): Promise<void> {
    setBrandData((await fetchBrandData()).data);
  }

  return {
    brandData,
    getBrandData,
    setBrandData,
    loadBrand,
  };
}
