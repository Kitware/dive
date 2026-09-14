export interface ChartPoint {
  x: number;
  y: number;
  /** Extra values shown in the hover tooltip, in insertion order */
  meta?: Record<string, number | string | null>;
}

export interface ChartSeries {
  name: string;
  color: string;
  points: ChartPoint[];
  dashed?: boolean;
}

export interface ChartMarker {
  x: number;
  label: string;
  color?: string;
}

export interface ChartHover {
  series: ChartSeries;
  point: ChartPoint;
}
