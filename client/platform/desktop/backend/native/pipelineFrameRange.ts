import fs from 'fs-extra';

/**
 * Shift the frame column of a VIAME CSV by a constant.
 *
 * A pipeline run on a frame range of an image sequence is given only the
 * images inside the range, so KWIVER numbers its output frames from 0 at the
 * first image it saw. The annotation import goes by that frame column, which
 * would put the results on the wrong images (and, since the import replaces
 * the dataset's annotations, make the range look lost). Adding the range's
 * first frame restores the dataset's own frame numbers. The filename column
 * is left as written.
 *
 * Comment and blank lines pass through unchanged, as do rows whose frame
 * column is not a number. The result is written beside the input.
 */
async function offsetCsvFrames(csvPath: string, offset: number): Promise<string> {
  const shiftedPath = csvPath.replace(/\.csv$/i, '_absolute.csv');
  const content = await fs.readFile(csvPath, 'utf-8');
  const shiftedLines = content.split('\n').map((line) => {
    if (line.startsWith('#') || line.trim() === '') {
      return line;
    }
    const parts = line.split(',');
    if (parts.length < 3) {
      return line;
    }
    const frame = parseInt(parts[2], 10);
    if (Number.isNaN(frame)) {
      return line;
    }
    parts[2] = String(frame + offset);
    return parts.join(',');
  });
  await fs.writeFile(shiftedPath, shiftedLines.join('\n'));
  return shiftedPath;
}

// eslint-disable-next-line import/prefer-default-export
export { offsetCsvFrames };
