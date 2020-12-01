**Detection** - A single slice of a track at a point in time.  Unusually the point of time is a frame of a video or a sequence of images.

**Features** - Bounding Rectangle, Head/Tail or other visible elements of a detection.

**Track** - A collection of detections spanned over multiple frames in a video or image sequence.  Tracks include a start and end time and can have periods in which no detections exist.

**Types** - a set of tracks that share specific display properties including color, line thickness, opacity.
Frame - a single image or point in time for a video or image sequence

**KeyFrame** - While using interpolation for tracks these are indicated as a locked position.  Interpolation is calculated linearly between keyframes to draw the bounding rects.

**Interpolation** - linearly moving the bounding rect of a detection over time between two keyframes.
