# prompt-service

A Vue plugin that provides a simple prompt service with Vuetify components in Vue components. It's functionality is similar to native `alert()` and `confirm()`.

## Install

Install the plugin by passing Vuetify as a parameter:

```JavaScript
import Vuetify from "vuetify/lib";
import promptService from "vue-utilities/prompt-service";

let vuetify = new Vuetify();
Vue.use(promptService(vuetify));
```

Attach container element to DOM after Vue app initialization using `$promptAttach()`:

```JavaScript
new Vue({
  render: h => h(App)
}).$mount("#app")
.$promptAttach();
```

## Import

Import the `usePrompt()` function which returns up to four different functions used for prompt services:

```JavaScript
import { usePrompt } from 'vue-utilities/prompt-service';

{ prompt, visible, invisible, hide } = usePrompt();
```

Not all functions need to be received, only get what is needed:

```JavaScript
{ prompt, visible } = usePrompt();
```

## Usage

### Showing the prompt box

Call `prompt({...})` within a Vue component.
Basic usage:

```JavaScript
prompt({ text: 'Record deleted.' });
```

All options:

```JavaScript
prompt({
  title: "Confirm",
  text: "Do you want to delete these items",
  positiveButton: "Confirm",
  negativeButton: "Cancel",
  confirm: true // show negative button
})
```

The `prompt({...})` function makes the prompt box appear and returns a `Promise<boolean>` when called. The promise is resolved with the boolean value representing the option chosen for the prompt.

To wait for dialog close result:

```JavaScript
const result = await prompt({...options}); // returns boolean when closed
if (result) {
  console.log("Closed with positive button");
} else {
  console.log("Closed with cancel button or clicked outside to close");
}
```

By default new Prompt is queued.

### Checking if visible

The `visible()` and `invisible()` functions returns a boolean if the prompt box is currently active.

```JavaScript
const isActive = visible(); // return true if active
const isInactive = invisible(); // returns true if inactive
```

### Hiding prompt box

The `hide()` function immediately hides the prompt box. This function is not recommended as the `prompt({...})` function will automatically hide when an option is clicked.

```JavaScript
hide();
```
