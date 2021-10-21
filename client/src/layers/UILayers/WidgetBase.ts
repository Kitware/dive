import { createApp } from '@vue/composition-api';

interface WidgetPosition {
    x: string | number;
    y: string | number;
}
export interface DOMWidget {
    canvas: () => HTMLElement;
    isInViewport: () => boolean;
    position: (pos: WidgetPosition) => WidgetPosition;
}

export default class WidgetBase {
    domWidget: DOMWidget;

    element: HTMLElement;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component: any;

    elementId: string;

    constructor(widget: DOMWidget, Component: any, props: any) {
      this.domWidget = widget;
      this.element = this.domWidget.canvas();
      let id = this.element.getAttribute('id');
      if (id === null) {
        id = 'default_name';
        this.element.setAttribute('id', id);
      }
      this.elementId = id;
      this.component = Component;
      createApp(this.component, props).mount(`#${this.elementId}`);
    }

    updatePosition(pos: WidgetPosition) {
      this.domWidget.position(pos);
    }
}
