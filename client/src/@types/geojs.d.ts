declare module 'geojs' {
  export interface GeoEvent {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }

  export interface GeoJSHTMLLayer {
      position: (pos?: { x: number; y: number}, actualValue?: boolean) =>
      {left: number | null; top: number | null; right: number | null; bottom: number | null};
      canvas: () => {
        id: string;
      };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geojs: any;
  export default geojs;
}
