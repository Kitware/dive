# annotator

An annotator maintains an instance of GeoJS.

## Usage

A **child component** of the annotator can consume its state and controls through the `Annotator` interface described in `./annotatorType.ts`.  See `../controls` for more in-depth examples.

### Example

``` typescript
import { injectMediaController } from 'vue-media-annotator/components/annotators/useMediaController';

export default defineComponent({
  setup() {
    const annotator = injectMediaController();
    /* ... */
    return {};
  },
});
```

## Linked viewer navigation

Multicam pan/zoom linking lives in `./linkedViewers/`. See that folder's [README](./linkedViewers/README.md) for how `useLinkedViewers` and `useAlignedNavigation` work, and how they relate to the aligned view and raw camera sync.

```typescript
import { useAlignedNavigation } from 'vue-media-annotator/components';
```
