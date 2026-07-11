/**
 * Video Search / IQR backend for Desktop
 *
 * Manages ONE shared search index covering every indexed dataset, plus a
 * persistent query service manager (viame.core.query_service) that holds the
 * KWIVER query/IQR pipeline open so refinement iterations are interactive.
 *
 * All database tables key rows on a per-video stream identifier
 * (VIDEO_NAME), so datasets are added to, updated in, and removed from the
 * shared database independently; a query searches every indexed dataset in
 * one IQR session.
 *
 * On-disk layout:
 *   <dataPath>/DIVE_SearchIndex/
 *     index_meta.json     - stream -> dataset membership, written by DIVE
 *     <stream>.txt        - media list handed to process_video.py
 *     database/           - embedded PostgreSQL data + ITQ/LSH index files
 */

import OS from 'os';
import crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import npath from 'path';
import readline from 'readline';
import fs from 'fs-extra';
import { EventEmitter } from 'events';

import {
  Settings, DesktopJob, DesktopJobUpdater,
  SearchIndexMeta, BuildSearchIndex, JsonMeta,
} from 'platform/desktop/constants';
import type { VideoSearchIndexStatus, VideoSearchIndexInfo } from 'dive-common/apispec';
import { serialize } from 'platform/desktop/backend/serializers/viame';
import { observeChild } from './processManager';
import * as common from './common';
import {
  jobFileEchoMiddleware, createCustomWorkingDirectory, getBinaryPath, spawnResult,
} from './utils';
import linux from './linux';
import win32 from './windows';

const GlobalIndexFolderName = 'DIVE_SearchIndex';
const IndexMetaFileName = 'index_meta.json';
const QueryPipelineName = 'query_retrieval_and_iqr.pipe';
const ExportTemplateName = npath.join('templates', 'detector_generic_svm.pipe');

const IndexPipelines: Record<BuildSearchIndex['method'], string> = {
  detections: 'index_default.pipe',
  tracking: 'index_default.trk.pipe',
  existing: 'index_existing.pipe',
};

function getCurrentPlatform() {
  return OS.platform() === 'win32' ? win32 : linux;
}

/**
 * Video search requires the query pipeline (built with database support) and
 * the bundled PostgreSQL binaries used to host the descriptor index.
 */
async function isVideoSearchInstalled(settings: Settings): Promise<boolean> {
  const pipelines = npath.join(settings.viamePath, 'configs', 'pipelines');
  const initdb = OS.platform() === 'win32' ? 'initdb.exe' : 'initdb';
  const checks = await Promise.all([
    fs.pathExists(npath.join(pipelines, QueryPipelineName)),
    fs.pathExists(npath.join(pipelines, 'sql_init_table.sql')),
    fs.pathExists(npath.join(settings.viamePath, 'bin', initdb)),
  ]);
  return checks.every((c) => c);
}

function getIndexDir(settings: Settings): string {
  return npath.join(settings.dataPath, GlobalIndexFolderName);
}

/** Filesystem/SQL-safe stream identifier token. */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export type SearchIndexStatus = VideoSearchIndexStatus;

async function readIndexMeta(settings: Settings): Promise<SearchIndexMeta> {
  const metaPath = npath.join(getIndexDir(settings), IndexMetaFileName);
  if (!(await fs.pathExists(metaPath))) {
    return { version: 1, streams: {} };
  }
  return (await fs.readJson(metaPath)) as SearchIndexMeta;
}

async function writeIndexMeta(settings: Settings, meta: SearchIndexMeta): Promise<void> {
  await fs.writeJson(npath.join(getIndexDir(settings), IndexMetaFileName), meta, { spaces: 2 });
}

/** The stream identifier a dataset's rows key on in the shared database. */
function streamNameForDataset(datasetId: string, meta: JsonMeta): string {
  if (meta.type === 'video') {
    // Videos are attributed by their filename stem (process_video derives
    // the ingest stream name from the input file's basename)
    return npath.parse(meta.originalVideoFile).name;
  }
  return sanitizeName(datasetId);
}

/** Whether the shared index is queryable (ITQ/LSH files present). */
async function indexIsBuilt(settings: Settings): Promise<boolean> {
  const itqDir = npath.join(getIndexDir(settings), 'database', 'ITQ');
  return (await fs.pathExists(itqDir))
    && (await fs.readdir(itqDir)).some((f) => f.startsWith('itq.model'));
}

async function getIndexStatus(settings: Settings, datasetId: string): Promise<SearchIndexStatus> {
  const meta = await readIndexMeta(settings);
  const built = await indexIsBuilt(settings);
  const streamName = Object.keys(meta.streams)
    .find((s) => meta.streams[s].datasetId === datasetId);
  return {
    built,
    indexed: built && streamName !== undefined,
    stream: streamName !== undefined
      ? { ...meta.streams[streamName], streamName } : undefined,
    datasetCount: built
      ? new Set(Object.values(meta.streams).map((s) => s.datasetId)).size : 0,
    meta,
  };
}

/** Every dataset present in the shared search index. */
async function listIndexedDatasets(settings: Settings): Promise<VideoSearchIndexInfo[]> {
  const meta = await readIndexMeta(settings);
  const entries = await Promise.all(
    Object.entries(meta.streams).map(async ([streamName, stream]) => {
      let name = stream.datasetId;
      try {
        const projectInfo = await common.getValidatedProjectDir(settings, stream.datasetId);
        const dsMeta = await common.loadJsonMetadata(projectInfo.metaFileAbsPath);
        name = dsMeta.name || stream.datasetId;
      } catch {
        // Dataset may have been deleted; keep the id as the display name.
      }
      return { streamName, datasetId: stream.datasetId, name };
    }),
  );
  return entries;
}

/**
 * Add (or update) one dataset in the shared search index as a DIVE job.
 *
 * The job chain: ensure the shared postgres is up (or initialize it on the
 * first ever build), delete the dataset's previous rows when updating, run
 * the ingest pipeline via process_video.py, and refresh the ITQ/LSH index
 * over the full database. The caller must close any open query session
 * first (the job needs the default postgres port).
 */
async function buildIndex(
  settings: Settings,
  args: BuildSearchIndex,
  updater: DesktopJobUpdater,
): Promise<DesktopJob> {
  const { datasetId, method } = args;
  const platform = getCurrentPlatform();
  const isValid = await platform.validateViamePath(settings);
  if (isValid !== true) {
    throw new Error(isValid);
  }

  const projectInfo = await common.getValidatedProjectDir(settings, datasetId);
  const meta = await common.loadJsonMetadata(projectInfo.metaFileAbsPath);
  if (meta.multiCam) {
    throw new Error('Search indexes are not yet supported on multi-camera datasets');
  }

  const indexDir = getIndexDir(settings);
  await fs.ensureDir(indexDir);

  const indexMeta = await readIndexMeta(settings);
  const streamName = streamNameForDataset(datasetId, meta);
  const existing = indexMeta.streams[streamName];
  if (existing && existing.datasetId !== datasetId) {
    throw new Error(
      `Stream identifier '${streamName}' already belongs to dataset `
      + `'${existing.datasetId}'; rename the media file to index both.`,
    );
  }

  // Media list: image sequences list every frame; videos list the one file.
  // The list file is named after the stream so image-sequence results
  // attribute back to the dataset directly.
  const ingestList = npath.join(indexDir, `${sanitizeName(streamName)}.txt`);
  if (meta.type === 'video') {
    const videoAbsPath = npath.join(meta.originalBasePath, meta.originalVideoFile);
    await fs.writeFile(ingestList, `${videoAbsPath}\n`);
  } else {
    const fileData = meta.originalImageFiles
      .map((f) => npath.join(meta.originalBasePath, f))
      .join('\n');
    await fs.writeFile(ingestList, `${fileData}\n`);
  }

  const viameConstants = platform.getViameConstants(settings);
  const pythonExe = platform.getViamePythonExe(settings);
  const configsDir = npath.join(settings.viamePath, 'configs');
  const firstBuild = !(await fs.pathExists(npath.join(indexDir, 'database', 'SQL')));

  const command: string[] = [viameConstants.setupScriptAbs];
  if (!firstBuild) {
    // Adding to an existing database: make sure it is running (the caller
    // closed the query service, so the default port is free)...
    command.push(`"${pythonExe}" "${npath.join(configsDir, 'database_tool.py')}" start`);
    if (existing) {
      // ...and drop the dataset's previous rows before re-ingest
      const removeSql = npath.join(indexDir, `${sanitizeName(streamName)}_remove.sql`);
      await fs.writeFile(removeSql, [
        'DELETE FROM TRACK_DESCRIPTOR_TRACK WHERE UID IN '
        + `(SELECT UID FROM TRACK_DESCRIPTOR WHERE VIDEO_NAME = '${streamName}');`,
        'DELETE FROM TRACK_DESCRIPTOR_HISTORY WHERE UID IN '
        + `(SELECT UID FROM TRACK_DESCRIPTOR WHERE VIDEO_NAME = '${streamName}');`,
        `DELETE FROM TRACK_DESCRIPTOR WHERE VIDEO_NAME = '${streamName}';`,
        `DELETE FROM DESCRIPTOR WHERE VIDEO_NAME = '${streamName}';`,
        `DELETE FROM OBJECT_TRACK WHERE VIDEO_NAME = '${streamName}';`,
        '',
      ].join('\n'));
      command.push(
        `psql -h localhost -d postgres -v ON_ERROR_STOP=1 -f "${removeSql}"`,
      );
    }
  }

  const processVideoInvocation = [
    `"${pythonExe}" "${npath.join(configsDir, 'process_video.py')}"`,
    firstBuild ? '--init' : '',
    '--no-reset-prompt',
    `-l "${ingestList}"`,
    `-p "pipelines/${IndexPipelines[method]}"`,
    '-o database',
    '--build-index',
    `-install "${settings.viamePath}"`,
  ].filter((part) => part.length);
  if (meta.type === 'video') {
    processVideoInvocation.push(`-frate ${meta.fps}`);
  }

  // Index around this dataset's existing annotations
  if (method === 'existing') {
    const detectionsCsv = npath.join(indexDir, `${sanitizeName(streamName)}_detections.csv`);
    const csvStream = fs.createWriteStream(detectionsCsv);
    const inputData = await common.loadAnnotationFile(projectInfo.trackFileAbsPath);
    await serialize(csvStream, inputData, meta);
    csvStream.end();
    processVideoInvocation.push(`-id "${detectionsCsv}"`);
  }
  command.push(processVideoInvocation.join(' '));

  const fullCommand = command.join(' && ');
  const jobWorkDir = await createCustomWorkingDirectory(settings, 'search_index', datasetId.replace('/', '_'));
  const joblog = npath.join(jobWorkDir, 'runlog.txt');

  const job = observeChild(spawn(fullCommand, {
    shell: viameConstants.shell,
    cwd: indexDir,
  }));

  const jobBase: DesktopJob = {
    key: `search_index_${job.pid}_${jobWorkDir}`,
    command: fullCommand,
    jobType: 'pipeline',
    pid: job.pid,
    args,
    title: `${existing ? 'Update' : 'Add'} search index (${method})`,
    workingDir: jobWorkDir,
    datasetIds: [datasetId],
    exitCode: job.exitCode,
    startTime: new Date(),
  };

  fs.writeFile(npath.join(jobWorkDir, 'dive_job_manifest.json'), JSON.stringify(jobBase, null, 2));

  updater({ ...jobBase, body: [''] });

  job.stdout.on('data', jobFileEchoMiddleware(jobBase, updater, joblog));
  job.stderr.on('data', jobFileEchoMiddleware(jobBase, updater, joblog));

  job.on('exit', async (code) => {
    if (code === 0) {
      try {
        const latest = await readIndexMeta(settings);
        latest.streams[streamName] = {
          datasetId,
          method,
          fps: meta.type === 'video' ? meta.fps : undefined,
          createdAt: (new Date()).toISOString(),
        };
        await writeIndexMeta(settings, latest);
      } catch (err) {
        console.error('Failed to write search index metadata', err);
      }
    }
    updater({
      ...jobBase, body: [''], exitCode: code, endTime: new Date(),
    });
  });
  return jobBase;
}

/**
 * Extract a single video frame as a PNG for use as a query exemplar or a
 * result thumbnail (the exemplar descriptor pipeline reads image files, not
 * videos). Extracted frames are cached in tmp, keyed on the source video's
 * identity (path + size + mtime, so a re-transcoded file invalidates) and
 * the requested timestamp (frame + fps, since two datasets can reference
 * the same video at different annotation framerates). Concurrent requests
 * for the same frame share one extraction.
 */
const frameExtractions = new Map<string, Promise<string>>();
const FrameCacheMaxFiles = 200;
let framePruneRunning = false;

/** Best-effort cap on cached frames: drop the oldest past the limit. */
async function pruneFrameCache(outDir: string) {
  if (framePruneRunning) return;
  framePruneRunning = true;
  try {
    const entries = await fs.readdir(outDir);
    if (entries.length <= FrameCacheMaxFiles) return;
    const stats = await Promise.all(entries.map(async (name) => {
      const filePath = npath.join(outDir, name);
      const stat = await fs.stat(filePath).catch(() => null);
      return { filePath, mtimeMs: stat?.mtimeMs ?? 0 };
    }));
    stats.sort((a, b) => a.mtimeMs - b.mtimeMs);
    const excess = stats.slice(0, stats.length - FrameCacheMaxFiles);
    await Promise.all(excess.map(({ filePath }) => fs.remove(filePath).catch(() => undefined)));
  } finally {
    framePruneRunning = false;
  }
}

async function extractVideoFrame(videoPath: string, frameNum: number, fps: number): Promise<string> {
  const outDir = npath.join(OS.tmpdir(), 'dive-video-search');
  const stat = await fs.stat(videoPath);
  const videoKey = crypto.createHash('md5')
    .update(`${videoPath}|${stat.size}|${Math.round(stat.mtimeMs)}|${fps}`)
    .digest('hex').slice(0, 16);
  const outPath = npath.join(outDir, `frame_${videoKey}_${frameNum}.png`);
  const inflight = frameExtractions.get(outPath);
  if (inflight) {
    return inflight;
  }
  const extraction = (async () => {
    await fs.ensureDir(outDir);
    if (await fs.pathExists(outPath)) {
      return outPath;
    }
    // Extract to a temp name and rename so a failed/interrupted ffmpeg run
    // can never leave a partial file where the cache check would find it.
    const tmpPath = npath.join(outDir, `tmp_${process.pid}_${videoKey}_${frameNum}.png`);
    const seconds = frameNum / (fps || 1);
    const ffmpegPath = getBinaryPath('ffmpeg-ffprobe-static/ffmpeg');
    const result = await spawnResult(ffmpegPath, [
      '-y', '-ss', seconds.toString(), '-i', videoPath, '-frames:v', '1', tmpPath,
    ]);
    if (result.exitCode !== 0 || !(await fs.pathExists(tmpPath))) {
      await fs.remove(tmpPath).catch(() => undefined);
      throw new Error(`Unable to extract video frame ${frameNum}: ${result.error}`);
    }
    await fs.move(tmpPath, outPath, { overwrite: true });
    pruneFrameCache(outDir).catch(() => undefined);
    return outPath;
  })();
  frameExtractions.set(outPath, extraction);
  try {
    return await extraction;
  } finally {
    frameExtractions.delete(outPath);
  }
}

/** Loose shape of a JSON response line from the Python query service. */
interface ServiceResponse {
  id: string;
  success?: boolean;
  error?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface PendingRequest {
  resolve: (response: ServiceResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * Manages ONE persistent viame.core.query_service subprocess speaking
 * newline-delimited JSON. Modeled on InteractiveServiceManager.
 */
export class QueryServiceManager extends EventEmitter {
  private process: ChildProcess | null = null;

  private readline: readline.Interface | null = null;

  private pendingRequests: Map<string, PendingRequest> = new Map();

  private isStarting = false;

  private startPromise: Promise<void> | null = null;

  private requestCounter = 0;

  /** Index directories currently opened in the service (primary first). */
  private currentIndexDirs: string[] = [];

  // First open loads the descriptor index + pipeline; queries train SVMs.
  private readonly requestTimeoutMs = 300000;

  isReady(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  openIndexDirs(): string[] {
    return this.isReady() ? this.currentIndexDirs : [];
  }

  private generateRequestId(): string {
    this.requestCounter += 1;
    return `req_${Date.now()}_${this.requestCounter}`;
  }

  async ensureStarted(settings: Settings): Promise<void> {
    if (this.isReady()) {
      return;
    }
    if (this.isStarting && this.startPromise) {
      await this.startPromise;
      return;
    }
    this.isStarting = true;
    this.startPromise = this.doStart(settings);
    try {
      await this.startPromise;
    } finally {
      this.isStarting = false;
    }
  }

  private async doStart(settings: Settings): Promise<void> {
    await this.shutdown();

    const platform = getCurrentPlatform();
    const isValid = await platform.validateViamePath(settings);
    if (isValid !== true) {
      throw new Error(isValid);
    }

    return new Promise((resolve, reject) => {
      const viameConstants = platform.getViameConstants(settings);
      const pythonExe = platform.getViamePythonExe(settings);
      const pyCommand = `"${pythonExe}" -s -m viame.core.query_service`;
      const command = `${viameConstants.setupScriptAbs} && ${pyCommand}`;

      // eslint-disable-next-line no-console
      console.log(`[VideoSearch] Starting query service: ${command}`);

      const stderrLines: string[] = [];
      const maxStderrLines = 20;

      this.process = observeChild(spawn(command, {
        shell: viameConstants.shell,
        cwd: settings.viamePath,
        stdio: ['pipe', 'pipe', 'pipe'],
      }));

      if (this.process.stdout) {
        this.readline = readline.createInterface({
          input: this.process.stdout,
          crlfDelay: Infinity,
        });
        this.readline.on('line', (line) => this.handleResponse(line));
      }

      let startupTimeout: NodeJS.Timeout | null = null;

      if (this.process.stderr) {
        this.process.stderr.on('data', (data: Buffer) => {
          const message = data.toString().trim();
          if (message) {
            // eslint-disable-next-line no-console
            console.log(`[VideoSearch] ${message}`);
            stderrLines.push(message);
            if (stderrLines.length > maxStderrLines) {
              stderrLines.shift();
            }
            if (message.includes('Service started, waiting for requests')) {
              if (startupTimeout) {
                clearTimeout(startupTimeout);
                startupTimeout = null;
              }
              resolve();
            }
          }
        });
      }

      const rejectStartup = (reason: string) => {
        if (!this.isStarting) {
          return;
        }
        this.isStarting = false;
        if (startupTimeout) {
          clearTimeout(startupTimeout);
          startupTimeout = null;
        }
        const details = stderrLines.filter((l) => l.trim()).slice(-8).join('\n  ');
        this.shutdown().finally(() => reject(new Error(
          `Unable to start the video search service. ${reason}\n`
          + `VIAME path: ${settings.viamePath}\n  ${details}`,
        )));
      };

      this.process.on('exit', (code, signal) => {
        // eslint-disable-next-line no-console
        console.log(`[VideoSearch] Process exited with code ${code}, signal ${signal}`);
        this.cleanup();
        if (this.isStarting) {
          rejectStartup(`The service process exited before it became ready (code ${code}, signal ${signal}).`);
        }
      });

      this.process.on('error', (err) => {
        console.error('[VideoSearch] Process error:', err);
        this.cleanup();
        if (this.isStarting) {
          rejectStartup(`Failed to start the service process: ${err.message}`);
        }
      });

      startupTimeout = setTimeout(() => {
        rejectStartup('The service did not become ready within 5 minutes.');
      }, 300000);
    });
  }

  private handleResponse(line: string): void {
    let response: ServiceResponse;
    try {
      response = JSON.parse(line) as ServiceResponse;
    } catch (err) {
      console.error('[VideoSearch] Failed to parse response:', line, err);
      return;
    }
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(response.id);
      pending.resolve(response);
    } else {
      console.warn(`[VideoSearch] Received response for unknown request: ${response.id}`);
    }
  }

  private sendRequest(payload: Record<string, unknown>, timeoutLabel: string): Promise<ServiceResponse> {
    if (!this.isReady() || !this.process?.stdin) {
      return Promise.reject(new Error('Video search service is not running'));
    }
    const id = this.generateRequestId();
    const fullRequest = { ...payload, id };
    return new Promise<ServiceResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`${timeoutLabel} request timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.process!.stdin!.write(`${JSON.stringify(fullRequest)}\n`, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          reject(err);
        }
      });
    });
  }

  private static check(response: ServiceResponse, label: string): ServiceResponse {
    if (!response.success) {
      throw new Error(response.error || `${label} failed`);
    }
    return response;
  }

  // -------------------------------------------------------------- commands

  /**
   * Open one or more indexes for federated search (primary first), closing
   * any previously open set if it differs. Each index gets its own embedded
   * postgres instance on an incremented port inside the service.
   */
  async openIndexes(settings: Settings, indexDirs: string[]): Promise<void> {
    await this.ensureStarted(settings);
    if (indexDirs.length === this.currentIndexDirs.length
      && indexDirs.every((dir, i) => this.currentIndexDirs[i] === dir)) {
      return;
    }
    if (this.currentIndexDirs.length) {
      await this.closeIndex();
    }
    const response = await this.sendRequest({ command: 'open_index', index_dirs: indexDirs }, 'Open index');
    QueryServiceManager.check(response, 'Opening the search indexes');
    this.currentIndexDirs = indexDirs;
  }

  async formulateQuery(imagePath: string, boxes?: number[][]): Promise<ServiceResponse> {
    const response = await this.sendRequest({
      command: 'formulate_query',
      image_path: imagePath,
      boxes,
    }, 'Query formulation');
    return QueryServiceManager.check(response, 'Query formulation');
  }

  async processQuery(threshold?: number, iqrModelB64?: string): Promise<ServiceResponse> {
    const response = await this.sendRequest({
      command: 'process_query',
      threshold: threshold ?? 0.0,
      iqr_model_b64: iqrModelB64,
    }, 'Query');
    return QueryServiceManager.check(response, 'Query');
  }

  async refine(positiveIds: string[], negativeIds: string[]): Promise<ServiceResponse> {
    const response = await this.sendRequest({
      command: 'refine',
      positive_ids: positiveIds,
      negative_ids: negativeIds,
    }, 'Query refinement');
    return QueryServiceManager.check(response, 'Query refinement');
  }

  async exportModel(outputPath?: string): Promise<ServiceResponse> {
    const response = await this.sendRequest({
      command: 'export_model',
      output_path: outputPath,
    }, 'Model export');
    return QueryServiceManager.check(response, 'Model export');
  }

  /**
   * Delete all database rows for the given stream identifiers in an index.
   * The service adopts or temporarily starts the index's postgres; if the
   * index was open, the session set is closed for consistency.
   */
  async removeStreams(indexDir: string, streams: string[]): Promise<void> {
    const response = await this.sendRequest({
      command: 'remove_streams', index_dir: indexDir, streams,
    }, 'Stream removal');
    QueryServiceManager.check(response, 'Stream removal');
    if (response.closed_session) {
      this.currentIndexDirs = [];
    }
  }

  async closeIndex(): Promise<void> {
    if (!this.isReady()) {
      this.currentIndexDirs = [];
      return;
    }
    try {
      await this.sendRequest({ command: 'close_index' }, 'Close index');
    } catch {
      // best effort - shutting the process down also stops postgres
    }
    this.currentIndexDirs = [];
  }

  // ------------------------------------------------------------- lifecycle

  private cleanup(): void {
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Video search service terminated'));
    });
    this.pendingRequests.clear();

    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }

    this.process = null;
    this.currentIndexDirs = [];
    this.emit('shutdown');
  }

  async shutdown(): Promise<void> {
    if (!this.process) {
      return;
    }
    // eslint-disable-next-line no-console
    console.log('[VideoSearch] Shutting down query service...');
    await new Promise<void>((resolve) => {
      const request = { id: this.generateRequestId(), command: 'shutdown' };
      if (this.process?.stdin?.writable) {
        this.process.stdin.write(`${JSON.stringify(request)}\n`);
      }
      const timeoutId = setTimeout(() => {
        if (this.process) {
          // eslint-disable-next-line no-console
          console.log('[VideoSearch] Force killing query service...');
          this.process.kill('SIGTERM');
        }
        this.cleanup();
        resolve();
      }, 10000);
      if (this.process) {
        this.process.once('exit', () => {
          clearTimeout(timeoutId);
          this.cleanup();
          resolve();
        });
      } else {
        clearTimeout(timeoutId);
        resolve();
      }
    });
  }
}

// Singleton instance shared by all IPC handlers.
let queryServiceManager: QueryServiceManager | null = null;

export function getQueryServiceManager(): QueryServiceManager {
  if (!queryServiceManager) {
    queryServiceManager = new QueryServiceManager();
  }
  return queryServiceManager;
}

export async function shutdownQueryService(): Promise<void> {
  if (queryServiceManager) {
    await queryServiceManager.shutdown();
    queryServiceManager = null;
  }
}

/**
 * Remove one dataset from the shared search index: delete its database rows
 * (via the query service, which owns postgres lifecycle) and drop it from
 * the membership metadata. Stale ITQ hash entries are tolerated by the
 * query engine and cleaned up on the next index build.
 */
async function removeFromIndex(settings: Settings, datasetId: string): Promise<void> {
  const meta = await readIndexMeta(settings);
  const streams = Object.keys(meta.streams)
    .filter((s) => meta.streams[s].datasetId === datasetId);
  if (!streams.length) {
    return;
  }
  const manager = getQueryServiceManager();
  await manager.ensureStarted(settings);
  await manager.removeStreams(getIndexDir(settings), streams);
  streams.forEach((s) => { delete meta.streams[s]; });
  await writeIndexMeta(settings, meta);
}

/** Delete the entire shared search index from disk. */
async function deleteEntireIndex(settings: Settings): Promise<void> {
  const manager = getQueryServiceManager();
  await manager.closeIndex();
  await fs.remove(getIndexDir(settings));
}

/**
 * Save the current IQR model as a runnable trained pipeline:
 * DIVE_Pipelines/<name>/ containing <name>.svm plus the generic-detector SVM
 * template as detector.pipe. Shows up under the "trained" pipeline category.
 */
async function exportSearchModel(settings: Settings, name: string): Promise<string> {
  const safeName = name.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
  if (!safeName) {
    throw new Error('A model name is required');
  }
  const manager = getQueryServiceManager();
  if (!manager.isReady() || !manager.openIndexDirs().length) {
    throw new Error('No active query session to export a model from');
  }
  const template = npath.join(settings.viamePath, 'configs', 'pipelines', ExportTemplateName);
  if (!(await fs.pathExists(template))) {
    throw new Error(`Missing pipeline template: ${template}`);
  }
  const outputDir = npath.join(settings.dataPath, 'DIVE_Pipelines', safeName);
  await fs.ensureDir(outputDir);
  await manager.exportModel(npath.join(outputDir, `${safeName}.svm`));
  await fs.copy(template, npath.join(outputDir, 'detector.pipe'));
  return outputDir;
}

export {
  isVideoSearchInstalled,
  getIndexDir,
  getIndexStatus,
  listIndexedDatasets,
  buildIndex,
  removeFromIndex,
  deleteEntireIndex,
  exportSearchModel,
  extractVideoFrame,
};
