# Rotation Support for Bounding Box Annotations

## Overview
This PR adds rotation support for bounding box annotations, allowing users to rotate rectangles and have the rotation persist as a detection attribute. The implementation stores rotated rectangles as axis-aligned bounding boxes with a rotation attribute, ensuring data consistency while providing a smooth editing experience.

## Features

### 1. Rotate Handle with Visual Feedback
- Added rotate handle to the EditAnnotationLayer for rectangle annotations
- Implemented hover cursor icon (`grab`) when hovering over the rotate handle
- Rotate handle is enabled in the `editHandleStyle()` method for rectangles

### 2. Rotation Calculation and Conversion
- **New utility functions in `utils.ts`:**
  - `calculateRotationFromPolygon()`: Calculates rotation angle in radians from polygon coordinates
  - `isAxisAligned()`: Checks if a rectangle is axis-aligned (not rotated)
  - `rotatedPolygonToAxisAlignedBbox()`: Converts rotated rectangles to axis-aligned bounding boxes by unrotating the polygon, preserving the original size

### 3. Rotation Storage
- Rotation is stored as a detection attribute named `rotation` (in radians)
- When a rectangle is rotated, it's converted to an axis-aligned bounding box with the rotation stored separately
- This approach ensures:
  - Data consistency (bounds remain axis-aligned)
  - No size changes when rotating (original bbox size is preserved)
  - Rotation can be easily applied during rendering

### 4. Editing Experience
- **During editing:** Rotated rectangles remain rotated to prevent corners from snapping back
- **On save:** Rotated rectangles are converted to axis-aligned bounds with rotation attribute
- **On load:** Rotation is restored from the detection attribute and applied to the rectangle for editing

### 5. Rendering Support
- **RectangleLayer** reads the rotation attribute and applies it when rendering
- Rotated rectangles are displayed correctly using the `applyRotationToPolygon()` method
- The rotation transformation is applied to axis-aligned bounding boxes to create the visual rotated rectangle

## Technical Details

### Key Changes

#### `client/src/utils.ts`
- Added `calculateRotationFromPolygon()` function
- Added `isAxisAligned()` function to detect axis-aligned rectangles
- Added `rotatedPolygonToAxisAlignedBbox()` function that:
  - Detects if rectangle is already axis-aligned
  - If rotated, unrotates the polygon around its center to find the original axis-aligned bbox
  - Returns both the axis-aligned bounds and rotation angle

#### `client/src/layers/EditAnnotationLayer.ts`
- Added rotate handle hover cursor support in `hoverEditHandle()`
- Updated `formatData()` to restore rotation when loading existing annotations
- Modified `handleEditAction()` to:
  - Keep rotated polygons during editing (prevents corner snapping)
  - Convert to axis-aligned bounds only when saving
  - Store rotation in GeoJSON properties
- Added `applyRotationToPolygon()` helper method to apply rotation transformations

#### `client/src/layers/AnnotationLayers/RectangleLayer.ts`
- Added `rotation` field to `RectGeoJSData` interface
- Updated `formatData()` to:
  - Read rotation from detection attributes
  - Apply rotation transformation when rendering
- Added `applyRotationToPolygon()` method to transform axis-aligned bboxes to rotated polygons

#### `client/dive-common/use/useModeManager.ts`
- Updated `handleUpdateRectBounds()` to accept optional `rotation` parameter
- Saves rotation as detection attribute when provided
- Removes rotation attribute when rotation is 0 or undefined

#### `client/src/components/LayerManager.vue`
- Updated to extract rotation from GeoJSON properties and pass it to `updateRectBounds()`

#### `client/src/provides.ts`
- Updated `Handler` interface to include optional `rotation` parameter in `updateRectBounds()`

## Bug Fixes

### Size Preservation
- **Issue:** Rotating a bounding box was changing its size because min/max calculations created a larger axis-aligned bbox
- **Fix:** Implemented unrotation logic that finds the original axis-aligned bbox by rotating the polygon back, preserving the exact original size

### Corner Snapping
- **Issue:** After rotating, grab corners would snap back to axis-aligned positions when editing
- **Fix:** Modified editing logic to keep rotated polygons during active editing, only converting to axis-aligned when saving

### Ghost Outline
- **Issue:** After rotation, an outline of the previous angle would remain visible
- **Fix:** Properly update annotation geometry in GeoJS to reflect axis-aligned coordinates

## Data Model

### Storage Format
- **Bounds:** Always stored as axis-aligned `[x1, y1, x2, y2]`
- **Rotation:** Stored as detection attribute `rotation` in radians
- **Display:** Rotation is applied during rendering to show the rotated rectangle

### Example
```javascript
// Storage
bounds: [100, 100, 200, 200]  // Axis-aligned
attributes: { rotation: 0.785 }  // 45 degrees in radians

// Display
// Rectangle is rendered rotated 45 degrees around its center
```

## Testing Considerations

1. **Rotation Persistence:** Verify rotation is saved and restored correctly
2. **Size Preservation:** Ensure rotating doesn't change the bounding box size
3. **Editing Experience:** Confirm corners don't snap during editing
4. **Visual Rendering:** Verify rotated rectangles display correctly
5. **Edge Cases:** Test with 0 rotation, 90-degree rotations, and near-axis-aligned rectangles

## Future Enhancements

- Text rotation alignment (reverted in this PR, can be re-implemented if needed)
- Rotation snapping to common angles (0°, 45°, 90°, etc.)
- Visual rotation indicator/angle display
