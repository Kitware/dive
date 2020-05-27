import { range } from 'd3';

/*eslint-disable */
export interface Range {
  begin: Number;
  end: Number;
  key: string;
}

export interface IRangeList {
  add: (...range: Range[]) => void;
  remove: (...key: string[]) => void;
  query: (i: Number) => Array<Range>;
  size: () => number;
}

export type InvalidRangeError = Error;

export default class ArrRangeList implements IRangeList {

  list: Array<Range>
  constructor() {
    this.list = [];
  }

  add(range: Range) {
    this.list.push(range);

  }

  remove(...key: String[]) {
  }

  update(range: Range) {
  }

  query(i: Number): Array<Range> {
    return this.list.filter((item) =>(item.begin <= i && i <= item.end));    
  }

  size(): number {
    return this.list.length;
  }
}
