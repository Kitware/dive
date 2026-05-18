declare module 'pngjs' {
  export default class PNG {
    width: number;

    height: number;

    data: Buffer;

    constructor(options?: { width?: number; height?: number });

    static sync: {
      write(png: PNG, options?: object): Buffer;
    };
  }
}
