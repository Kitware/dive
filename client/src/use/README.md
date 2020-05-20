# Detection-centric model

Before: Detection array with frozen entries.

``` js
detections = [
  Object.freeze({ frame: 1, trackId: 1, bounds: {}, attributes: {} ...}),
  Object.freeze({ frame: 1, trackId: 1, bounds: {}, attributes: {} ...}),
  Object.freeze({ frame: 1, trackId: 1, bounds: {}, attributes: {} ...}),
]
```

## Preventing observability

Object.freeze is used, so that to do any update, the entire detection must be replaced.  This causes global recalculation of literally everything.  I've lost track of how many O(N) loops are triggered by any edit, but it's in the 15-30 range.

## Other problems

Interpolation isn't possible because bitmap-style access is used on a global list.  Sparse arrays are fast but lack flexibility.  Involves pre-computation of all frames rather than on-the-fly lookup

# Track-centric

``` js
tracks [
  { trackid: '1', attributes: {}, confidencePairs: {}, features: [...]},
  { trackid: '1', attributes: {}, confidencePairs: {}, features: [...]},
  { trackid: '1', attributes: {}, confidencePairs: {}, features: [...]},
]
```

## Preventing Observability

Now, to prevent vue observability, we have to mirror properties that may be used in Vue templates (or in other words, properties that must be reactive.).

* For example, track.start and track.end are used to reactively construct the track timeline view at the bottom of the page.

If we maintain a non-reactive "deep" class instance of track and a reactive "shallow" instance, we can update the shallow one when the deep one changes.  This will result in far fewer O(N) looping computed properties to fire when state changes.

## Problems

On-the-fly frame bounds lookup comes with its own challenges....

1. Build a list of tracks that contain detections at the current frame.  (Expensive!)
  a. Augmented Range lists, bitmaps, and other data structures can speed this up.
  b. But building and maintaining those structures won't be possible without a track-centric model
2. Figure out the upper and lower tight bounding detections for that frame. (Expensive!)
  a. This is where sparse arrays excel
  b. Hybrid approach where we maintain a sparse array for lookups and a dense array of sparse indices for binary search.
  c.  Interpolating multiple shape types, like heat/tail and bounds, for example, will be even more expensive because this step must be duplicated for every different shape type.  It also costs memory because a whole sparse array and corresponding index search array must be maintained separately.
3. interpolate. (Cheap)
