<script lang="ts">
import {
  defineComponent, ref, Ref, toRef,
} from '@vue/composition-api';
import { putBrandData, getBrandData, BrandData } from 'platform/web-girder/api/configuration.service';


export default defineComponent({
  name: 'AdminBranding',
  setup(props, { root }) {
    const brandData: Ref<BrandData> = ref({});
    const rootBrandData = toRef(root.$store.state.Brand, 'brandData');
    const getData = async () => {
      const resp = await getBrandData();
      brandData.value = { ...rootBrandData.value, ...resp.data };
    };
    getData();
    const uploadBranding = async () => {
      await putBrandData(brandData.value);
      await getData();
    };
    return {
      brandData,
      uploadBranding,
    };
  },

});
</script>

<template>
  <v-container>
    <v-card>
      <v-card-title> Branding </v-card-title>
      <v-card-text>
        <p>
          Below are settings that can be configured for branding.
        </p>
        <v-row>
          <v-text-field
            v-model="brandData.name"
            label="Name"
            type="text"
          />
        </v-row>
        <v-row>
          <v-text-field
            v-model="brandData.loginMessage"
            type="text"
            label="Login Message"
          />
        </v-row>
        <v-row>
          <v-text-field
            v-model="brandData.trainingMessage"
            type="text"
            label="Training Message"
          />
        </v-row>
        <v-row>
          <v-text-field
            v-model="brandData.alertMessage"
            type="text"
            label="Alert Message"
            clearable
          />
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          color="success"
          class="ml-2"
          @click="uploadBranding"
        >
          Set Branding
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-container>
</template>
