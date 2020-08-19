import girderRest from '@/plugins/girder';
// import ElectronApi from './electron';

let API;
if (process.env.IS_ELECTRON) {
  // API = new ElectronApi();
  API = girderRest;
} else {
  API = girderRest
}
export default API;
