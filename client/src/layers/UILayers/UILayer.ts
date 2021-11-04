import { createApp } from '@vue/composition-api';
import { MediaController } from '../../components/annotators/mediaControllerType';


interface WidgetPosition {
  x: string | number;
  y: string | number;
}
export interface DOMWidget {
  canvas: () => HTMLElement;
  isInViewport: () => boolean;
  position: (pos: WidgetPosition) => WidgetPosition;
}
/**
 * UILayer provides a way to add Reactive VUE DOM Widgets to GeoJS
 * These widgets are created under their own Vue App and can't rely on parent elements
 * for reactivity.
 * Reactive properties for these components will need to be passed in as Refs and
 * dereferenced inside of the Vue component to properly update.
 * This will probably change once Vue 3 is adopted and <teleport> can be used
 */
export default class UILayer {
    annotator: MediaController;

    widgets: Record<string, DOMWidget>;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    uiLayer: any;

    constructor(annotator: MediaController) {
      this.annotator = annotator;
      this.widgets = {};
      this.uiLayer = this.annotator.geoViewerRef.value.createLayer('ui');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addDOMWidget(name: string, component: any, props: any, position = { x: 0, y: 0 }) {
      const widget: DOMWidget = this.uiLayer.createWidget('dom', { position });
      widget.canvas().setAttribute('id', name);
      const parent = widget.canvas();
      const div = document.createElement('div');
      const element = parent.appendChild(div);
      createApp(component, props).mount(element);
      this.widgets[name] = widget;

      return widget;
    }
}
