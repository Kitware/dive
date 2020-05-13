import { geojsonToBound, geojsonToBound2 } from '@/utils';

export default function useEditingLayer({
  // data
  prompt, // TODO: refactor
  frame,
  detections,
  tracks,
  editingTrackId,
  editingDetection,
  // methods
  setTrackEditMode,
  deleteDetection,
  setDetection,
}) {
  async function deleteTrack(track) {
    if (!track) {
      return;
    }
    const { trackId } = track;
    if (typeof trackId !== 'number') {
      throw new Error('Must provide object with key `trackId` to deleteTrack()');
    }
    const _detections = detections.value;
    const result = await prompt({
      title: 'Confirm',
      text: `Please confirm to delete track ${trackId}`,
      confirm: true,
    });
    if (result) {
      // Iterate in reverse so that earlier deletions
      // don't affect array indexes for later deletions
      for (let i = _detections.length - 1, n = 0; i >= n; i -= 1) {
        const detection = _detections[i];
        if (detection.track === trackId) {
          deleteDetection(i);
        }
      }
    }
  }

  function detectionChanged(feature) {
    const _detections = detections.value;
    const _editingTrackId = editingTrackId.value;
    const _editingDetection = editingDetection.value;
    const _tracks = tracks.value;
    const _frame = frame.value;

    if (_editingTrackId === null) {
      return;
    }
    const bounds = feature.type === 'Feature'
      ? geojsonToBound2(feature.geometry)
      : geojsonToBound(feature);
    let confidencePairs = [];
    const trackMeta = _tracks.find(
      (track) => track.trackId === _editingTrackId,
    );
    if (trackMeta) {
      confidencePairs = trackMeta.confidencePairs;
    }
    // if there's an existing detection

    if (_editingDetection !== null) {
      const index = _detections.indexOf(_editingDetection);
      setDetection(index, {
        ..._editingDetection,
        track: _editingTrackId,
        confidencePairs,
        frame: _frame,
        features: _editingDetection.features || {},
        bounds,
      });
      // else create a new one at the end, with a type labeled 'undefined' meant to be changed
    } else {
      setDetection(_detections.length, {
        track: _editingTrackId,
        confidencePairs: [['undefined', 1]],
        frame: _frame,
        features: {},
        confidence: 1,
        fishLength: -1,
        attributes: null,
        trackAttributes: null,
        bounds,
      });
    }
  }

  function trackTypeChanged(track, type) {
    detections.value.forEach((detection, index) => {
      if (detection.track === track.trackId) {
        setDetection(index, {
          ...detection,
          confidence: 1,
          confidencePairs: [[type, 1]],
        });
      }
    });
  }

  function addTrack() {
    const newId = tracks.value.length
      ? tracks.value.slice(-1)[0].trackId + 1
      : 1;
    setTrackEditMode(newId, true);
  }

  return {
    addTrack,
    deleteTrack,
    detectionChanged,
    trackTypeChanged,
  };
}
