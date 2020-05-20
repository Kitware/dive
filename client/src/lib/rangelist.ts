/*eslint-disable */
export interface Range {
  begin: Number;
  end: Number;
  key: String;
}

export interface IRangeList {
  add: (...range: Range[]) => void;
  remove: (...key: String[]) => void;
  query: (i: Number) => Array<Range>;
  size: () => number;
}

export type InvalidRangeError = Error;

export default class ArrRangeList implements IRangeList {
  constructor() {
  }

  add(...range: Range[]) {

  }

  remove(...key: String[]) {
  }

  update(range: Range) {
  }

  query(i: Number): Array<Range> {
    return [];
  }

  size(): number {
    return 1;
  }
}
