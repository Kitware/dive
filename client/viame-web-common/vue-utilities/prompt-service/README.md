## prompt-service
A Vue plugin that provides a simple prompt service with Vutify components in Vue components. It's functionality is similar to native alert() and confirm(), prompt() is not supported.

### Install
Install plugin
```JavaScript
import Vuetify from "vuetify/lib";
import promptService from "vue-utilities/prompt-service";

let vuetify = new Vuetify();
Vue.use(promptService(vuetify));
```
Attach container element to DOM after Vue app initialization
```JavaScript
new Vue({
  render: h => h(App)
}).$mount("#app")
.$promptAttach();
```
### Usage
Call `this.$prompt()` Within Vue Component

Basic usage
```JavaScript
this.$prompt({ text: 'Record deleted.'});
```
all options
```JavaScript
this.$prompt({
  title: "Confirm",
  text: "Do you want to delete these items",
  positiveButton: "Confirm",
  negativeButton: "Cancel",
  confirm: true //show negative button
})
```

Wait dialog close result
```JavaScript
var result = await this.$prompt({...options});
if (result === true) {
  console.log("Closed with positive button");
} else if (result === false) {
  console.log("Closed with cancel button or clicked outside to close");
}
```
By default new Prompt is queued.
