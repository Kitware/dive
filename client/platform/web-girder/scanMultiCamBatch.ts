/**
 * Batch multicam import scanner for the web (browser File list + webkitRelativePath).
 */
import {
  CollectRawScan,
  CollectSubfolderScan,
  scanMultiCamBatchFromCollects,
} from 'dive-common/multiCamBatchScan';
import { filterMediaFiles } from 'dive-common/components/ImportMultiCamDialog/multicamSubfolderLayout';

function normalizeRootPath(rootPath: string): string {
  return rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
}

function relativePath(file: File): string {
  return (file.webkitRelativePath || file.name).replace(/\\/g, '/');
}

function pathWithinPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function directChildNames(prefix: string, paths: string[]): Set<string> {
  const childPrefix = `${prefix}/`;
  const children = new Set<string>();
  paths.forEach((path) => {
    if (!path.startsWith(childPrefix)) {
      return;
    }
    const rest = path.slice(childPrefix.length);
    const parts = rest.split('/').filter(Boolean);
    if (parts.length >= 1) {
      children.add(parts[0]);
    }
  });
  return children;
}

function scanCollectFromFiles(collectPath: string, allFiles: File[]): Map<string, CollectSubfolderScan> {
  const normalizedCollectPath = normalizeRootPath(collectPath);
  const collectPrefix = `${normalizedCollectPath}/`;
  const relPaths = allFiles.map((file) => relativePath(file));
  const subfolderNames = directChildNames(normalizedCollectPath, relPaths);
  const subfolders = new Map<string, CollectSubfolderScan>();

  subfolderNames.forEach((folderName) => {
    const subfolderPath = `${normalizedCollectPath}/${folderName}`;
    const subfolderPrefix = `${subfolderPath}/`;
    const filesInSubfolder = allFiles.filter((file) => pathWithinPrefix(relativePath(file), subfolderPath));
    const directChildPaths = filesInSubfolder
      .map((file) => relativePath(file))
      .filter((path) => path.startsWith(subfolderPrefix))
      .map((path) => path.slice(subfolderPrefix.length))
      .filter((rest) => rest.length > 0);
    const directEntries = new Set<string>();
    directChildPaths.forEach((rest) => {
      const [first] = rest.split('/');
      if (first) {
        directEntries.add(first);
      }
    });
    const directFiles = filesInSubfolder.filter((file) => {
      const rest = relativePath(file).slice(subfolderPrefix.length);
      return rest.length > 0 && !rest.includes('/');
    });
    subfolders.set(folderName.toLowerCase(), {
      folderName,
      path: subfolderPath,
      entryCount: directEntries.size,
      imageCount: filterMediaFiles(directFiles, 'image-sequence').length,
    });
  });

  return subfolders;
}

export function scanMultiCamBatchFromFiles(
  rootPath: string,
  files: File[],
): ReturnType<typeof scanMultiCamBatchFromCollects> {
  const normalizedRoot = normalizeRootPath(rootPath);
  const relPaths = files.map((file) => relativePath(file));
  const collectNames = [...directChildNames(normalizedRoot, relPaths)].sort((a, b) => a.localeCompare(b));
  const rawScans: CollectRawScan[] = collectNames.map((name) => ({
    name,
    path: `${normalizedRoot}/${name}`,
    subfolders: scanCollectFromFiles(`${normalizedRoot}/${name}`, files),
  }));
  return scanMultiCamBatchFromCollects(normalizedRoot, rawScans);
}

export function filesForCameraSource(sourcePath: string, allFiles: File[]): File[] {
  const normalizedSource = normalizeRootPath(sourcePath);
  return allFiles.filter((file) => pathWithinPrefix(relativePath(file), normalizedSource));
}
