import { createApp } from '@vue/composition-api';
import { MediaController } from 'vue-media-annotator/components/annotators/mediaControllerType';


interface WidgetPosition {
  x: string | number;
  y: string | number;
}
export interface DOMWidget {
  canvas: () => HTMLElement;
  isInViewport: () => boolean;
  position: (pos: WidgetPosition) => WidgetPosition;
}
export default class UILayer {
    annotator: MediaController;

    widgets: Record<string, {elementId: string; widget: DOMWidget}>;

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
      let id = element.getAttribute('id');
      if (id === null) {
        id = 'default_name';
        element.setAttribute('id', id);
      }
      const elementId = id;
      createApp(component, props).mount(`#${elementId}`);
      this.widgets[name] = { widget, elementId };

      return widget;
    }

    getDOMWidget(name: string) {
      if (this.widgets[name]) {
        return this.widgets[name];
      }
      throw new Error(`No DOM widget exsist with the name: ${name}`);
    }

    updateDOMPosition(name: string, pos: WidgetPosition) {
      const widget = this.getDOMWidget(name)?.widget;
      if (widget) {
        widget.position(pos);
      }
    }
}
