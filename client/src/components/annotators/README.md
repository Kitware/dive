# annotator

An annotator maintains an instance of GeoJS.

## state

The state available on the injected Vue annotator instance.

```js
geoViewer // geojs viewer
playing // boolean
frame // number
maxFrame // number
syncedFrame // TODO: what makes this different than frame?
```

## methods

Available method names are:

```js
'seek' // takes number arg
'prev-frame'
'next-frame'
'pause'
'play'
```

Interact with the state by emitting events to the injected Vue annotator instance:

```js
// example: request that the annotator seek to frame 10
this.annotator.$emit('seek', 10);
```

## base mixin

Annotator mixin contains common base functionality.  To implement an annotator, a component should

* implement methods: `play()`, `pause()`, and `seek(frame: number)`
* creating GeoJS feature layers and calling `draw()`
* adding a `created` hook that calls `baseInit()`
