declare module '@girder/components/src' {
  import { AxiosInstance, AxiosResponse } from 'axios';
  import Vue from 'vue';

  export interface GirderModel {
    name: string;
    created: string;
    creatorId: string;
    updated: string;
    _id: string;
    _modelType: 'item' | 'folder' | 'file' | 'user';
    parentCollection: string;
    parentId: string;
    baseParentId: string;
    meta: unknown;
    size: number;
  }

  export interface GirderJob extends GirderModel {
    status: number;
  }

  interface GirderRestClientParams {
    apiRoot: string;
    token?: string;
    axios?: AxiosInstance;
    authenticateWithCredentials?: boolean;
    userGirderAuthorizationHeader?: boolean;
    setLocalCokie?: boolean;
  }

  class RestClient extends Vue {
    constructor(params: GirderRestClientParams);

    fetchUser(): Promise<GirderModel>;

    login(username: string, password: string, opt: string | null): Promise<AxiosResponse>;

    logout(): void;

    register(
      login: string,
      email: string,
      firstName: string,
      lastName: string,
      password: string,
      admin: boolean,
    ): Promise<AxiosResponse>;

    apiRoot: string;

    // below inherited from Axios
    defaults: AxiosInstance['defaults'];

    interceptors: AxiosInstance['interceptors'];

    getUri: AxiosInstance['getUri'];

    request: AxiosInstance['request'];

    delete: AxiosInstance['delete'];

    put: AxiosInstance['put'];

    get: AxiosInstance['get'];

    head: AxiosInstance['head'];

    options: AxiosInstance['options'];

    post: AxiosInstance['post'];

    patch: AxiosInstance['patch'];
  }

  interface GirderPlugin {
    install: Vue.PluginFunction<void>;
  }

  const plugin: GirderPlugin;

  export { RestClient };
  export default plugin;
}
