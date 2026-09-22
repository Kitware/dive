declare module 'pngjs' {
  export class PNG {
    width: number;

    height: number;

    data: Buffer;

    constructor(options?: { width?: number; height?: number });

    static sync: {
      read(buffer: Buffer, options?: object): PNG;
      write(png: PNG, options?: object): Buffer;
    };
  }

  export default PNG;
}
