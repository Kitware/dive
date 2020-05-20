
declare module '@girder/components/src' {
  import { PluginFunction } from 'vue/types';
  import { AxiosInstance, AxiosResponse } from "axios";
  import Vue from 'vue';

  interface GirderUser {
    name: string;
    _id: string;
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
    fetchUser(): Promise<GirderUser>;
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
    install: PluginFunction<void>;
  }

  const plugin: GirderPlugin;

  export { RestClient };
  export default plugin;
}
