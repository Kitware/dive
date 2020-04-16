import { ref } from '@vue/composition-api';

export default function attributeManager({
  detections,
  selectedTrack,
  selectedDetection,
  markChangesPending,
  setDetection,
}) {
  const attributeEditing = ref(false); // TODO: document what this is
  /**
   * Change the track attributes for a single detection
   * @param {String} name
   * @param {any} value
   */
  function trackAttributeChange_(name, value) {
    const _selectedTrack = selectedTrack.value;
    const _detections = detections.value;
    let detectionToChange = null;

    if (_selectedTrack.trackAttributes) {
      detectionToChange = _detections.find(
        (detection) => detection.track === _selectedTrack.trackId
          && detection.trackAttributes,
      );
    } else {
      detectionToChange = _detections.find(
        (detection) => detection.track === _selectedTrack.trackId,
      );
    }
    setDetection(_detections.indexOf(detectionToChange), {
      ...detectionToChange,
      trackAttributes: {
        ...detectionToChange.trackAttributes,
        [name]: value,
      },
    });
  }

  /**
   * Change the detection attributes for a single detection
   * @param {String} name
   * @param {any} value
   */
  function detectionAttributeChange_(name, value) {
    const detectionToChange = selectedDetection.value;
    const _detections = detections.value;
    setDetection(_detections.indexOf(detectionToChange), {
      ...detectionToChange,
      attributes: {
        ...detectionToChange.attributes,
        [name]: value,
      },
    });
  }

  function attributeChange({ type, name, value }) {
    if (type === 'track') {
      trackAttributeChange_(name, value);
    } else if (type === 'detection') {
      detectionAttributeChange_(name, value);
    }
    markChangesPending();
  }

  function setAttributeEditing(val) {
    attributeEditing.value = val;
  }

  return { attributeEditing, setAttributeEditing, attributeChange };
}
