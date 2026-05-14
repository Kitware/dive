/* eslint-disable import/prefer-default-export -- singleton composable store */
import { merge } from 'lodash';
import { ref } from 'vue';

import girderRest from '../plugins/girder';
import type { UserState } from './types';

const user = ref<UserState['user']>(null);

export function useUser() {
  function getUser(): UserState['user'] {
    return user.value;
  }

  function setUser(next: UserState['user']): void {
    user.value = next;
  }

  async function loadUser(): Promise<void> {
    const data = await girderRest.fetchUser();
    user.value = merge({}, user.value, data as object);
  }

  return {
    user,
    getUser,
    setUser,
    loadUser,
  };
}
