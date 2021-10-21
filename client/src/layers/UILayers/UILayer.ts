import { MediaController } from 'vue-media-annotator/components/annotators/mediaControllerType';
import { DOMWidget } from './WidgetBase';


export default class UILayer {
    annotator: MediaController;

    widgets: DOMWidget[];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    uiLayer: any;

    constructor(annotator: MediaController) {
      this.annotator = annotator;
      this.widgets = [];
      this.uiLayer = this.annotator.geoViewerRef.value.createLayer('ui');
    }

    addDOMWidget(name: string, { x, y } = { x: 0, y: 0 }) {
      const widget: DOMWidget = this.uiLayer.createWidget('dom', { position: { x, y } });
      widget.canvas().setAttribute('id', name);
      this.widgets.push(widget);
      return widget;
    }
}
