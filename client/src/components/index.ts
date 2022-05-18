/**
 * TODO: DANGER: this file must be a javascript (not typescript)
 * file for the sake of rollup build process.
 * See rollup.config.js for more
 */

import ImageAnnotator from './annotators/ImageAnnotator.vue';
import VideoAnnotator from './annotators/VideoAnnotator.vue';

import Controls from './controls/Controls.vue';
import EventChart from './controls/EventChart.vue';
import FileNameTimeDisplay from './controls/FileNameTimeDisplay.vue';
import LineChart from './controls/LineChart.vue';
import Timeline from './controls/Timeline.vue';

import FilterList from './FilterList.vue';
import GroupEditor from './GroupEditor.vue';
import GroupList from './GroupList.vue';
import GroupItem from './GroupItem.vue';
import ImageEnhancements from './ImageEnhancements.vue';
import LayerManager from './LayerManager.vue';
import TooltipButton from './TooltipButton.vue';
import TrackItem from './TrackItem.vue';
import TrackList from './TrackList.vue';
import TypeEditor from './TypeEditor.vue';
import TypeItem from './TypeItem.vue';
import TypePicker from './TypePicker.vue';

export * from './annotators/useMediaController';
export {
  /* Annotators */
  ImageAnnotator,
  VideoAnnotator,
  /* Controls */
  Controls,
  EventChart,
  FileNameTimeDisplay,
  LineChart,
  Timeline,
  /* Components */
  FilterList,
  GroupEditor,
  GroupItem,
  GroupList,
  ImageEnhancements,
  LayerManager,
  TooltipButton,
  TrackItem,
  TrackList,
  TypeEditor,
  TypeItem,
  TypePicker,
};
