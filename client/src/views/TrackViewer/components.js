// Annotators
import VideoAnnotator from '@/components/annotators/VideoAnnotator.vue';
import ImageAnnotator from '@/components/annotators/ImageAnnotator.vue';
// Layers
import TextLayer from '@/components/layers/TextLayer.vue';
import MarkerLayer from '@/components/layers/MarkerLayer.vue';
import AnnotationLayer from '@/components/layers/AnnotationLayer.vue';
import EditAnnotationLayer from '@/components/layers/EditAnnotationLayer.vue';
// Controls
import Controls from '@/components/controls/Controls.vue';
import TimelineWrapper from '@/components/controls/TimelineWrapper.vue';
import Timeline from '@/components/controls/Timeline.vue';
import LineChart from '@/components/controls/LineChart.vue';
import EventChart from '@/components/controls/EventChart.vue';
// Other normal components
import NavigationTitle from '@/components/NavigationTitle.vue';
import ConfidenceFilter from '@/components/ConfidenceFilter.vue';

import TypeList from '@/components/TypeList.vue';
import AttributesPanel from '@/components/AttributesPanel.vue';
import UserGuideButton from '@/components/UserGuideButton.vue';

const ViewerComponents = {
  NavigationTitle,
  VideoAnnotator,
  ImageAnnotator,
  Controls,
  AnnotationLayer,
  EditAnnotationLayer,
  TextLayer,
  MarkerLayer,
  Timeline,
  TimelineWrapper,
  ConfidenceFilter,
  TypeList,
  AttributesPanel,
  LineChart,
  EventChart,
  UserGuideButton,
};

export default ViewerComponents;
