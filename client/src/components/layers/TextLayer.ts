import BaseLayer from '@/components/layers/BaseLayer';

export default class TextLayer extends BaseLayer {
  initialize() {
    const layer = this.annotator.geoViewer.createLayer('feature', {
      features: ['text'],
    });
    this.featureLayer = layer
      .createFeature('text')
      .text((data) => data.text)
      .position((data) => ({ x: data.x, y: data.y }));
    super.initialize();
  }

  formatData(frameData: FrameDataTrack[]) {
    const arr = super.formatData(frameData);
    frameData.forEach((track: FrameDataTrack) => {
      if (track.features && track.features.bounds) {
        const { bounds } = track.features;
        if (bounds) {
          track.confidencePairs.forEach(([type, confidence], i) => {
            arr.push({
              selected: track.selected,
              editing: track.editing,
              confidencePairs: track.confidencePairs,
              text: `${type}: ${confidence.toFixed(2)}`,
              x: bounds[1],
              y: bounds[2],
              offsetY: i * 14,
            });
          });
        }
        if (false) {
          this.redraw();
        }
        // eslint-disable-next-line max-len
        // this.redrawSignalers.push(new Proxy([coords, track.confidencePairs], this.redraw));
      }
    });
    return arr;
  }

  redraw() {
    this.featureLayer.data(this.formattedData).draw();
    return null;
  }

  createStyle() {
    const baseStyle = super.createStyle();
    const textStyle = {
      fontSize: '14px',
      textAlign: 'left',
      color: this.stateStyling.standard.color,
      textBaseline: 'top',
    };
    return {
      ...baseStyle,
      color: (data) => {
        if (data.editing) {
          if (!data.selected) {
            if (this.stateStyling.disabled.color !== 'type') {
              return this.stateStyling.disabled.color;
            }
            if (data.confidencePairs && data.confidencePairs.length) {
              return this.typeColorMap(data.confidencePairs[0][0]);
            }
          }
          return this.stateStyling.selected.color;
        }
        if (data.selected) {
          return this.stateStyling.selected.color;
        }
        if (data.confidencePairs && data.confidencePairs.length) {
          return this.typeColorMap(data.confidencePairs[0][0]);
        }
        return this.stateStyling.standard.color;
      },
      offset(data) {
        const offset = {
          x: 3,
          y: 0,
        };
        if (data.offsetY) {
          offset.y = data.offsetY;
        }
        if (data.offsetX) {
          offset.y = data.offsetX;
        }
        return offset;
      },
    };
  }
}
