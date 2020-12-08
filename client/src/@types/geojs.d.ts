declare module 'geojs' {
  export interface GeoEvent {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geojs: any;
  export default geojs;
}
