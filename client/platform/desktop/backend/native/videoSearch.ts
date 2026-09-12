/**
 * Video Search / IQR backend for Desktop
 *
 * Manages ONE shared search index covering every indexed dataset, plus a
 * persistent query service manager (viame.core.query_service) that holds the
 * KWIVER query/IQR pipeline open so refinement iterations are interactive.
 *
 * Every indexed dataset is one stream (video/sequence identifier), so
 * datasets are added to, updated in, and removed from the shared index
 * independently; a query searches every indexed dataset in one IQR session.
 *
 * Two storage backends exist (SearchIndexBackend). The default keeps one
 * set of files per stream and needs no server process; the PostgreSQL one
 * is retained for deployments that prefer the embedded database.
 *
 * On-disk layout:
 *   <dataPath>/DIVE_SearchIndex/
 *     index_meta.json               - stream -> dataset membership and backend, written by DIVE
 *     <stream>.txt                  - media list handed to viame index add
 *     database/
 *       ITQ/                        - the shared ITQ model (+ legacy global hash files)
 *       <stream>.index              - files backend: manifest marking an indexed stream
 *       <stream>_descriptors.csv    - files backend: descriptor uids, track refs, history
 *       <stream>_descriptors.npy    - files backend: float32 descriptor matrix
 *       <stream>_uids.txt           - files backend: uid per matrix row
 *       <stream>_hashes.npy         - files backend: ITQ hash codes per row
 *       <stream>_tracks.csv         - files backend: object tracks of the stream
 *       SQL/                        - postgres backend: embedded database data
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
  SearchIndexMeta, BuildSearchIndex, JsonConfig,
} from 'platform/desktop/constants';
import { orderedMultiCamCameraNames } from 'dive-common/multicamDisplay';
import type {
  VideoSearchIndexStatus, VideoSearchIndexInfo, SearchIndexBackend,
} from 'dive-common/apispec';
import { serialize } from 'platform/desktop/backend/serializers/viame';
import { observeChild } from './processManager';
import * as common from './common';
import {
  jobFileEchoMiddleware, createCustomWorkingDirectory, getBinaryPath, spawnResult,
} from './utils';
import linux from './linux';
import win32 from './windows';

const GlobalIndexFolderName = 'DIVE_SearchIndex';

/**
 * The backend new indexes are built with. 'files' (per-stream bundles, no
 * server) is the default; 'postgres' keeps the embedded database path
 * alive for anyone who wants to switch back. An existing index keeps the
 * backend it was created with (recorded in index_meta.json).
 */
export const DefaultSearchIndexBackend: SearchIndexBackend = 'files';

/** Files that make up one stream of a file-backed index. */
const StreamBundlePostfixes = [
  '.index', '_descriptors.csv', '_descriptors.npy', '_uids.txt', '_hashes.npy', '_tracks.csv',
];
const IndexMetaFileName = 'index_meta.json';
const QueryPipelineName = 'query_retrieval_and_iqr.pipe';
const ExportTemplateName = npath.join('templates', 'detector_generic_svm.pipe');

/** viame index --method for each build method. */
const IndexMethods: Record<BuildSearchIndex['method'], string> = {
  detections: 'detections',
  tracking: 'tracking',
  existing: 'existing',
};

function getCurrentPlatform() {
  return OS.platform() === 'win32' ? win32 : linux;
}

/**
 * Video search requires the query pipeline and the index build tooling;
 * the PostgreSQL backend additionally needs the bundled database binaries.
 */
async function isVideoSearchInstalled(
  settings: Settings,
  backend: SearchIndexBackend = DefaultSearchIndexBackend,
): Promise<boolean> {
  const configs = npath.join(settings.viamePath, 'configs');
  const pipelines = npath.join(configs, 'pipelines');
  const checks = [
    fs.pathExists(npath.join(pipelines, QueryPipelineName)),
    fs.pathExists(npath.join(configs, 'index.py')),
  ];
  if (backend === 'postgres') {
    const initdb = OS.platform() === 'win32' ? 'initdb.exe' : 'initdb';
    checks.push(
      fs.pathExists(npath.join(pipelines, 'sql_init_table.sql')),
      fs.pathExists(npath.join(settings.viamePath, 'bin', initdb)),
    );
  }
  return (await Promise.all(checks)).every((c) => c);
}

/** Run `viame index <args>` inside the shared index folder and wait for it. */
async function runIndexTool(settings: Settings, args: string[]): Promise<void> {
  const platform = getCurrentPlatform();
  const viameConstants = platform.getViameConstants(settings);
  const pythonExe = platform.getViamePythonExe(settings);
  const indexScript = npath.join(settings.viamePath, 'configs', 'index.py');
  const quoted = args.map((a) => `"${a}"`).join(' ');
  const command = [
    viameConstants.setupScriptAbs,
    `"${pythonExe}" "${indexScript}" ${quoted}`,
  ].join(' && ');
  const child = observeChild(spawn(command, { shell: viameConstants.shell, cwd: getIndexDir(settings) }));
  let stderr = '';
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf-8'); });
  const exitCode = await new Promise<number | null>((resolve) => { child.on('exit', resolve); });
  if (exitCode !== 0) {
    throw new Error(`viame index ${args[0]} failed (exit ${exitCode}): ${stderr.trim().split('\n').slice(-3).join(' ')}`);
  }
}

/** Delete one stream's bundle files (files backend). */
async function removeStreamFiles(settings: Settings, streamName: string): Promise<void> {
  const database = npath.join(getIndexDir(settings), 'database');
  await Promise.all(StreamBundlePostfixes.map(async (postfix) => {
    await fs.remove(npath.join(database, sanitizeName(streamName) + postfix)).catch(() => undefined);
  }));
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
function streamNameForDataset(datasetId: string, meta: JsonConfig): string {
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
        const dsMeta = await common.loadJsonConfig(projectInfo.datasetFileAbsPath);
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
  beforeStart?: () => Promise<void>,
): Promise<DesktopJob> {
  const jobBase: DesktopJob = {
    key: `search_index_${crypto.randomBytes(16).toString('hex')}`,
    command: '',
    workingDir: '',
    jobType: 'indexing',
    pid: -1,
    args,
    title: `Add search index (${args.method})`,
    datasetIds: [args.datasetId],
    exitCode: null,
    startTime: new Date(),
  };
  updater({ ...jobBase, body: ['Preparing search index…'] });
  try {
    await beforeStart?.();
    return await startIndexBuild(settings, args, updater, jobBase);
  } catch (error) {
    jobBase.exitCode = 1;
    jobBase.endTime = new Date();
    updater({ ...jobBase, body: [`ERROR: ${error instanceof Error ? error.message : String(error)}`] });
    return jobBase;
  }
}

async function startIndexBuild(settings: Settings, args: BuildSearchIndex, updater: DesktopJobUpdater, registeredJob: DesktopJob): Promise<DesktopJob> {
  const jobBase = registeredJob;
  const { method } = args;
  let { datasetId } = args;
  const platform = getCurrentPlatform();
  const isValid = await platform.validateViamePath(settings);
  if (isValid !== true) {
    throw new Error(isValid);
  }

  let projectInfo = await common.getValidatedProjectDir(settings, datasetId);
  let meta = await common.loadJsonConfig(projectInfo.datasetFileAbsPath);
  if (meta.multiCam) {
    const [camera] = orderedMultiCamCameraNames(meta.multiCam);
    if (!camera) throw new Error('This multicamera dataset has no cameras to index');
    datasetId = `${datasetId}/${camera}`;
    jobBase.datasetIds = [args.datasetId, datasetId];
    updater({ ...jobBase, body: [`Indexing first camera: ${camera} (${datasetId})`] });
    projectInfo = await common.getValidatedProjectDir(settings, datasetId);
    meta = await common.loadJsonConfig(projectInfo.datasetFileAbsPath);
  }
  updater({ ...jobBase, body: [`Index source: ${datasetId}`] });

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

  // Image sequences are handed over as a list of frames named after the
  // stream, so results attribute back to the dataset; a video is passed as
  // the video itself (a list would be read as images and fail to decode).
  const ingestList = npath.join(indexDir, `${sanitizeName(streamName)}.txt`);
  let inputArg: string;
  if (meta.type === 'video') {
    const videoAbsPath = npath.join(meta.originalBasePath, meta.originalVideoFile);
    inputArg = `-v "${videoAbsPath}"`;
  } else {
    const fileData = meta.originalImageFiles
      .map((f: string) => npath.join(meta.originalBasePath, f))
      .join('\n');
    await fs.writeFile(ingestList, `${fileData}\n`);
    inputArg = `-l "${ingestList}"`;
  }

  const viameConstants = platform.getViameConstants(settings);
  const pythonExe = platform.getViamePythonExe(settings);
  const configsDir = npath.join(settings.viamePath, 'configs');
  // The backend is fixed when the shared index is first built; every later
  // build joins the same store. Indexes from before the backend was
  // recorded were always postgres.
  const backend: SearchIndexBackend = indexMeta.backend
    ?? (Object.keys(indexMeta.streams).length > 0 ? 'postgres' : DefaultSearchIndexBackend);

  const command: string[] = [viameConstants.setupScriptAbs];
  if (backend === 'files' && existing) {
    // Rebuilding a stream: drop its previous bundle so stale files are not
    // mistaken for current ones by the bundle builder.
    await removeStreamFiles(settings, streamName);
  }

  // viame index add owns the rest: database initialisation and start for
  // the postgres backend, the ingest pipeline, and the hash refresh.
  const indexInvocation = [
    `"${pythonExe}" "${npath.join(configsDir, 'index.py')}" add`,
    inputArg,
    `--method ${IndexMethods[method]}`,
    '--database database',
    `--backend ${backend}`,
    '--yes',
    `-install "${settings.viamePath}"`,
  ];
  if (meta.type === 'video') {
    indexInvocation.push(`-frate ${meta.fps}`);
  }
  if (method === 'existing') {
    const detectionsCsv = npath.join(indexDir, `${sanitizeName(streamName)}_detections.csv`);
    const csvStream = fs.createWriteStream(detectionsCsv);
    const inputData = await common.loadAnnotationFile(projectInfo.trackFileAbsPath);
    await serialize(csvStream, inputData, meta);
    csvStream.end();
    indexInvocation.push(`-id "${detectionsCsv}"`);
  }
  command.push(indexInvocation.join(' '));

  const fullCommand = command.join(' && ');
  const jobWorkDir = await createCustomWorkingDirectory(settings, 'search_index', datasetId.replace('/', '_'));
  const joblog = npath.join(jobWorkDir, 'runlog.txt');

  const job = observeChild(spawn(fullCommand, {
    shell: viameConstants.shell,
    cwd: indexDir,
  }));
  if (job.pid === undefined) {
    job.on('error', () => { /* The preparation failure is reported below. */ });
    throw new Error('Failed to spawn the search index build');
  }

  Object.assign(jobBase, {
    command: fullCommand,
    pid: job.pid,
    title: `${existing ? 'Update' : 'Add'} search index (${method})`,
    workingDir: jobWorkDir,
  });

  fs.writeFile(npath.join(jobWorkDir, 'dive_job_manifest.json'), JSON.stringify(jobBase, null, 2))
    .catch((error) => updater({ ...jobBase, body: [`Could not save job manifest: ${error}`] }));

  updater({ ...jobBase, body: [`Command: ${fullCommand}`] });

  job.stdout.on('data', jobFileEchoMiddleware(jobBase, updater, joblog));
  job.stderr.on('data', jobFileEchoMiddleware(jobBase, updater, joblog));

  job.on('error', (error) => {
    jobBase.exitCode = 1;
    jobBase.endTime = new Date();
    updater({ ...jobBase, body: [`ERROR: ${error.message}`] });
  });
  job.on('close', async (code) => {
    if (jobBase.endTime) return;
    if (code === 0) {
      try {
        const latest = await readIndexMeta(settings);
        latest.backend = backend;
        latest.streams[streamName] = {
          datasetId,
          method,
          fps: meta.type === 'video' ? meta.fps : undefined,
          createdAt: (new Date()).toISOString(),
        };
        await writeIndexMeta(settings, latest);
      } catch (err) {
        jobBase.exitCode = 1;
        updater({ ...jobBase, body: [`ERROR: Failed to write search index metadata: ${err}`] });
      }
    }
    jobBase.exitCode = jobBase.exitCode ?? code;
    jobBase.endTime = new Date();
    updater({ ...jobBase, body: [''] });
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
  async openIndexes(
    settings: Settings,
    indexDirs: string[],
    backend: SearchIndexBackend = DefaultSearchIndexBackend,
  ): Promise<void> {
    await this.ensureStarted(settings);
    if (indexDirs.length === this.currentIndexDirs.length
      && indexDirs.every((dir, i) => this.currentIndexDirs[i] === dir)) {
      return;
    }
    if (this.currentIndexDirs.length) {
      await this.closeIndex();
    }
    const response = await this.sendRequest({
      command: 'open_index', index_dirs: indexDirs, backend,
    }, 'Open index');
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
  async removeStreams(
    indexDir: string,
    streams: string[],
    backend: SearchIndexBackend,
  ): Promise<void> {
    const response = await this.sendRequest({
      command: 'remove_streams', index_dir: indexDir, streams, backend,
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
  const backend: SearchIndexBackend = meta.backend ?? 'postgres';
  const manager = getQueryServiceManager();
  // Any open query session still holds the removed vectors in memory.
  await manager.closeIndex();
  if (backend === 'files') {
    await Promise.all(streams.map((s) => removeStreamFiles(settings, s)));
  } else {
    await runIndexTool(settings, ['remove', '--database', 'database', '--backend', backend, ...streams]);
  }
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
  readIndexMeta,
  getIndexStatus,
  listIndexedDatasets,
  buildIndex,
  removeFromIndex,
  deleteEntireIndex,
  exportSearchModel,
  extractVideoFrame,
};
