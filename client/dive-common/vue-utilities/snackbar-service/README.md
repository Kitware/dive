## snackbar-service
A Vue plugin that provides a Snackbar service in Vue components.

This plugin depends on Vuetify `<v-snackbar>` component

### Install
Install plugin
```JavaScript
import Vuetify from "vuetify/lib";
import snackbarService from "vue-utilities/snackbar-service";

let vuetify = new Vuetify();
Vue.use(snackbarService(vuetify));
```
Attach container element to DOM after Vue app initialization
```JavaScript
new Vue({
  render: h => h(App)
}).$mount("#app")
.$snackbarAttach();
```
### Usage
Call `this.$snackbar()` Within Vue Component

Basic usage
```JavaScript
this.$snackbar({ text: 'Import complete.'});
```
all options
```JavaScript
this.$snackbar({
  text: "Item saved",
  button: "Undo",
  timeout: 6000,
  immediate: true,
  callback: () => {
    this.undo();
  }
})
```
Set snackbar options
```JavaScript
this.$snackbar.setOptions({ bottom: true })
```
or set with `$snackbarAttach()`
```JavaScript
new Vue({
  render: h => h(App)
}).$mount("#app")
.$snackbarAttach({ right: true });
```

By default new Snackbar is queued. But immediate option will hide current snackbar and show new one immediately.
