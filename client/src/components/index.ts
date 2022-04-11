/**
 * TODO: DANGER: this file must be a javascript (not typescript)
 * file for the sake of rollup build process.
 * See rollup.config.js for more
 */

import ImageAnnotator from './annotators/ImageAnnotator.vue';
import VideoAnnotator from './annotators/VideoAnnotator.vue';

import Controls from './controls/Controls.vue';
import EventChart from './controls/EventChart.vue';
import LineChart from './controls/LineChart.vue';
import Timeline from './controls/Timeline.vue';

import ImageEnhancements from './ImageEnhancements.vue';
import LayerManager from './LayerManager.vue';
import TooltipButton from './TooltipButton.vue';
import TrackItem from './TrackItem.vue';
import TrackList from './TrackList.vue';
import TypeList from './TypeList.vue';

export * from './annotators/useMediaController';
export {
  ImageEnhancements,
  ImageAnnotator,
  VideoAnnotator,
  Controls,
  EventChart,
  LineChart,
  Timeline,
  LayerManager,
  TooltipButton,
  TrackItem,
  TrackList,
  TypeList,
};
