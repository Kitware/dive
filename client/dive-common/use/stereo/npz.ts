/**
 * Minimal client-side reader for NumPy `.npz` archives (a ZIP of `.npy` arrays)
 * and individual `.npy` buffers. Used to parse stereo calibration files
 * (produced by `np.savez(... R, T, cameraMatrixL, ...)`) in the browser, so the
 * stereo ONNX matcher needs no backend.
 *
 * Only what calibration needs is supported: little-endian numeric dtypes,
 * C-order arrays, and ZIP entries that are either stored or DEFLATE-compressed
 * (decompressed with the platform `DecompressionStream`, available in modern
 * browsers, Electron, and Node 18+).
 */

export interface NpyArray {
  dtype: string; // numpy descr, e.g. '<f8'
  shape: number[];
  /** Flat data in C order, as JS numbers. */
  data: Float64Array;
}

const TEXT = new TextDecoder('latin1');

function dtypeReader(dtype: string): (dv: DataView, off: number) => number {
  // Strip byte-order char; we only support little-endian (the numpy default).
  const kind = dtype.replace(/^[<>=|]/, '');
  switch (kind) {
    case 'f8': return (dv, o) => dv.getFloat64(o, true);
    case 'f4': return (dv, o) => dv.getFloat32(o, true);
    case 'i8': return (dv, o) => Number(dv.getBigInt64(o, true));
    case 'i4': return (dv, o) => dv.getInt32(o, true);
    case 'i2': return (dv, o) => dv.getInt16(o, true);
    case 'i1': return (dv, o) => dv.getInt8(o);
    case 'u8': return (dv, o) => Number(dv.getBigUint64(o, true));
    case 'u4': return (dv, o) => dv.getUint32(o, true);
    case 'u1': return (dv, o) => dv.getUint8(o);
    default: throw new Error(`Unsupported npy dtype: ${dtype}`);
  }
}

function dtypeSize(dtype: string): number {
  return parseInt(dtype.replace(/^[<>=|][a-z]/i, ''), 10);
}

/** Parse a single `.npy` buffer into an {@link NpyArray}. */
export function parseNpy(buf: Uint8Array): NpyArray {
  if (buf[0] !== 0x93 || TEXT.decode(buf.subarray(1, 6)) !== 'NUMPY') {
    throw new Error('Not a .npy file');
  }
  const major = buf[6];
  let headerLen: number;
  let headerStart: number;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (major === 1) {
    headerLen = dv.getUint16(8, true);
    headerStart = 10;
  } else {
    headerLen = dv.getUint32(8, true);
    headerStart = 12;
  }
  const header = TEXT.decode(buf.subarray(headerStart, headerStart + headerLen));
  const descr = (/'descr'\s*:\s*'([^']+)'/.exec(header) || [])[1];
  const shapeStr = (/'shape'\s*:\s*\(([^)]*)\)/.exec(header) || [])[1] ?? '';
  if (!descr) throw new Error('Could not parse npy header descr');
  if (/'fortran_order'\s*:\s*True/.test(header)) {
    throw new Error('Fortran-order npy arrays are not supported');
  }
  const shape = shapeStr.split(',')
    .map((s) => s.trim()).filter((s) => s.length)
    .map((s) => parseInt(s, 10));

  const dataStart = headerStart + headerLen;
  const read = dtypeReader(descr);
  const size = dtypeSize(descr);
  const count = shape.reduce((a, b) => a * b, 1);
  const data = new Float64Array(count);
  const ddv = new DataView(buf.buffer, buf.byteOffset + dataStart);
  for (let i = 0; i < count; i += 1) {
    data[i] = read(ddv, i * size);
  }
  return { dtype: descr, shape, data };
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  // deflate-raw decompression, available in browsers / Electron / Node 18+.
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

/**
 * Parse a `.npz` archive into a map of array name (without the `.npy`
 * extension) to {@link NpyArray}. Reads the ZIP central directory so it works
 * regardless of how the archive was written.
 */
export async function parseNpz(
  buffer: ArrayBuffer | Uint8Array,
): Promise<Record<string, NpyArray>> {
  // Accept a Uint8Array/Buffer too, honoring its byteOffset/length: Node's
  // readFileSync returns a Buffer backed by a shared pool, so `.buffer` is
  // larger than the file. Build the view from the exact bytes.
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  // Locate the End Of Central Directory record (scan back over its 22-byte
  // fixed part plus any trailing comment).
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i -= 1) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .npz (no ZIP end-of-central-directory)');

  const entryCount = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true); // central directory offset
  const out: Record<string, NpyArray> = {};

  for (let e = 0; e < entryCount; e += 1) {
    if (dv.getUint32(p, true) !== 0x02014b50) {
      throw new Error('Corrupt ZIP central directory');
    }
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = TEXT.decode(u8.subarray(p + 46, p + 46 + nameLen));

    // Local header: 30 fixed bytes + name + extra, then the file data.
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataOff = localOff + 30 + lNameLen + lExtraLen;
    const raw = u8.subarray(dataOff, dataOff + compSize);

    let npyBytes: Uint8Array;
    if (method === 0) {
      npyBytes = raw;
    } else if (method === 8) {
      // eslint-disable-next-line no-await-in-loop
      npyBytes = await inflateRaw(raw);
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
    }

    const key = name.replace(/\.npy$/, '');
    out[key] = parseNpy(npyBytes);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
