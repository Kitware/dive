import { createApp } from '@vue/composition-api';
import geo, { GeoEvent } from 'geojs';
import { MediaController } from '../../components/annotators/mediaControllerType';


interface WidgetPosition {
  x: number;
  y: number;
}

export interface DOMWidget {
  canvas: () => HTMLElement;
  isInViewport: () => boolean;
  position: (pos: WidgetPosition) => void;
  toolTip: boolean | undefined;
  toolTipOffset: {x: number; y: number};
  lastMousePos: WidgetPosition;
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
      this.uiLayer.geoOn(geo.event.mousemove, this.updateToolTipPositions);
      this.uiLayer.geoOn(geo.event.zoom, this.zoomToolTipPosition);
    }

    updateWidgetToolTipPosition(offset: WidgetPosition, widget: DOMWidget) {
      const tipOffset = widget.toolTipOffset;
      const newOffset = this.uiLayer.map().gcsToDisplay(offset);
      const finalOffset = this.uiLayer.map().displayToGcs(
        {
          x: newOffset.x + tipOffset.x, y: newOffset.y + tipOffset.y,
        },
      );
      widget.position(finalOffset);
    }

    zoomToolTipPosition = () => {
      Object.keys(this.widgets).forEach((name) => {
        if (this.widgets[name].toolTip) {
          const offset = this.widgets[name].lastMousePos;
          this.updateWidgetToolTipPosition(offset, this.widgets[name]);
        }
      });
    };

    updateToolTipPositions = (evt: GeoEvent) => {
      Object.keys(this.widgets).forEach((name) => {
        if (this.widgets[name].toolTip) {
          const offset = evt.geo;
          const tipOffset = this.widgets[name].toolTipOffset;
          const newOffset = this.uiLayer.map().gcsToDisplay(offset);
          const finalOffset = this.uiLayer.map().displayToGcs(
            {
              x: newOffset.x + tipOffset.x, y: newOffset.y + tipOffset.y,
            },
          );
          this.widgets[name].position(finalOffset);
          this.widgets[name].lastMousePos = evt.geo;
        }
      });
    };


    addDOMWidget(
      name: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      component: any, props: any,
      position = { x: 0, y: 0 },
    ) {
      const widget: DOMWidget = this.uiLayer.createWidget('dom', { position });
      widget.canvas().setAttribute('id', name);
      const parent = widget.canvas();
      const div = document.createElement('div');
      const element = parent.appendChild(div);
      createApp(component, props).mount(element);
      widget.toolTipOffset = position;
      widget.toolTip = false;
      widget.lastMousePos = position;
      this.widgets[name] = widget;
      return widget;
    }

    setToolTipWidget(name: string, on: boolean) {
      if (this.widgets[name]) {
        this.widgets[name].toolTip = on;
      }
    }
}
