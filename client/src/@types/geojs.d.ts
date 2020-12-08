declare module 'geojs' {
  export interface GeoEvent {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }

  interface GeoMap {
    bounds: () => {};
    maxBounds: () => {};
  }

  interface GeoJS {
    map: () => GeoMap;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geojs: GeoJS & any;
  export default geojs;
}
