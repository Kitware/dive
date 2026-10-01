import fs from 'fs-extra';
import { createWriteStream } from 'fs';
import path from 'path';
import { ZipFile } from 'yazl';

export type ZipCompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

function zipEntryOptions(compressionLevel: ZipCompressionLevel) {
  return { compress: true, compressionLevel };
}

async function collectFiles(root: string): Promise<{ absolutePath: string; entryName: string }[]> {
  async function walk(directory: string): Promise<{ absolutePath: string; entryName: string }[]> {
    const names = await fs.readdir(directory);
    const nested = await Promise.all(names.map(async (name) => {
      const absolutePath = path.join(directory, name);
      const info = await fs.lstat(absolutePath);
      if (info.isDirectory()) {
        return walk(absolutePath);
      }
      if (info.isFile()) {
        const entryName = path.relative(root, absolutePath).split(path.sep).join('/');
        return [{ absolutePath, entryName }];
      }
      return [];
    }));
    return nested.flat();
  }
  return walk(root);
}

export async function writeZipToFile(
  outputPath: string,
  populate: (zip: ZipFile) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const zip = new ZipFile();
    const output = createWriteStream(outputPath);
    const fail = (error: Error) => {
      output.destroy();
      reject(error);
    };
    output.on('error', fail);
    zip.outputStream.on('error', fail);
    output.on('close', resolve);
    zip.outputStream.pipe(output);
    populate(zip);
    zip.end();
  });
}

export async function zipFilesToFile(
  outputPath: string,
  files: { absolutePath: string; entryName: string }[],
  compressionLevel: ZipCompressionLevel,
): Promise<void> {
  const options = zipEntryOptions(compressionLevel);
  await writeZipToFile(outputPath, (zip) => {
    files.forEach(({ absolutePath, entryName }) => {
      zip.addFile(absolutePath, entryName, options);
    });
  });
}

export async function zipDirectoryToFile(
  sourceDir: string,
  outputPath: string,
  compressionLevel: ZipCompressionLevel,
): Promise<void> {
  const files = await collectFiles(sourceDir);
  await zipFilesToFile(outputPath, files, compressionLevel);
}
