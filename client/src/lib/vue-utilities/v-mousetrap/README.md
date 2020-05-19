## v-mousetrap
A Vue plugin that provide binding to [mousetrap](https://craig.is/killing/mice) as Vue directive.

The key benefit of this library is that the keyboard binding will share the same life cycle as the bound element. it will be created and destroyed as the element created and destroyed.

### Install
Install peer dependancy

```npm install mousetrap```


Install plugin
```JavaScript
import vMousetrap from "vue-utilities/v-mousetrap";
Vue.use(vMousetrap);
```

### Usage

Value of `bind` will be passed to mousetrap as first argument and the `handler` will be passed as the second argument. The first argument of the handler will be the bound element or component. Rest of the arguments will be the passed directly from mousetrap.

Single binding
```html
<div v-mousetrap="{ bind: 'b', handler: () => {} }"></div>
```
Multiple binding
```html
<div v-mousetrap="[
    { bind: '=', handler: increase },
    { bind: '-', handler: decrease }
  ]"></div>
```
Disabled
```html
<div v-mousetrap="{ bind:'alt+s', handler: save, disabled: !changed }"></div>
```
By default event is bound to the `document`, but with the `.element` modifier the handler will be bound to the directive element.
```html
<textarea v-mousetrap.element="{ bind:'esc', handler: el => el.blur() }"></textarea>
```
