/**
 * Video Search / IQR backend for Desktop
 *
 * Provides per-dataset search index management (build via a process_video.py
 * job, status, delete) and a persistent query service manager
 * (viame.core.query_service) that holds the KWIVER query/IQR pipeline open so
 * refinement iterations are interactive. One index may be open at a time (the
 * embedded PostgreSQL instance binds a fixed port), enforced here by closing
 * the previous index before opening another.
 *
 * On-disk layout (per dataset):
 *   <dataPath>/DIVE_Projects/<datasetId>/search_index/
 *     index_meta.json     - written by DIVE on successful build
 *     ingest_list.txt     - media list handed to process_video.py
 *     database/           - embedded PostgreSQL data + ITQ/LSH index files
 */

import OS from 'os';
import { spawn, ChildProcess } from 'child_process';
import npath from 'path';
import readline from 'readline';
import fs from 'fs-extra';
import { EventEmitter } from 'events';

import {
  Settings, DesktopJob, DesktopJobUpdater,
  SearchIndexMeta, BuildSearchIndex,
} from 'platform/desktop/constants';
import { serialize } from 'platform/desktop/backend/serializers/viame';
import { observeChild } from './processManager';
import * as common from './common';
import { jobFileEchoMiddleware, createCustomWorkingDirectory } from './utils';
import linux from './linux';
import win32 from './windows';

const SearchIndexFolderName = 'search_index';
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

function getIndexDir(settings: Settings, datasetId: string): string {
  return npath.join(settings.dataPath, 'DIVE_Projects', datasetId, SearchIndexFolderName);
}

export interface SearchIndexStatus {
  exists: boolean;
  built: boolean;
  meta?: SearchIndexMeta;
}

async function getIndexStatus(settings: Settings, datasetId: string): Promise<SearchIndexStatus> {
  const indexDir = getIndexDir(settings, datasetId);
  const metaPath = npath.join(indexDir, IndexMetaFileName);
  if (!(await fs.pathExists(metaPath))) {
    return { exists: await fs.pathExists(indexDir), built: false };
  }
  const meta = (await fs.readJson(metaPath)) as SearchIndexMeta;
  // Sanity: the ITQ model files must exist for the index to be queryable
  const itqDir = npath.join(indexDir, 'database', 'ITQ');
  const built = (await fs.pathExists(itqDir))
    && (await fs.readdir(itqDir)).some((f) => f.startsWith('itq.model'));
  return { exists: true, built, meta };
}

/**
 * Build (or rebuild) the search index for a dataset by running
 * process_video.py --init --build-index as a DIVE job.
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

  const indexDir = getIndexDir(settings, datasetId);
  // Rebuild from scratch: the DB re-init inside process_video handles the
  // database folder, but a stale meta file must not mark a failed build as
  // usable.
  await fs.remove(npath.join(indexDir, IndexMetaFileName));
  await fs.ensureDir(indexDir);

  // Media list: image sequences list every frame; videos list the one file.
  const ingestList = npath.join(indexDir, 'ingest_list.txt');
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
  const processVideo = npath.join(settings.viamePath, 'configs', 'process_video.py');

  const command = [
    `${viameConstants.setupScriptAbs} &&`,
    `"${pythonExe}" "${processVideo}"`,
    '--init --no-reset-prompt',
    `-l "${ingestList}"`,
    `-p "pipelines/${IndexPipelines[method]}"`,
    '-o database',
    '--build-index',
    `-install "${settings.viamePath}"`,
  ];
  if (meta.type === 'video') {
    command.push(`-frate ${meta.fps}`);
  }

  // Index around this dataset's existing annotations
  if (method === 'existing') {
    const detectionsCsv = npath.join(indexDir, 'input_detections.csv');
    const csvStream = fs.createWriteStream(detectionsCsv);
    const inputData = await common.loadAnnotationFile(projectInfo.trackFileAbsPath);
    await serialize(csvStream, inputData, meta);
    csvStream.end();
    command.push(`-id "${detectionsCsv}"`);
  }

  const jobWorkDir = await createCustomWorkingDirectory(settings, 'search_index', datasetId.replace('/', '_'));
  const joblog = npath.join(jobWorkDir, 'runlog.txt');

  const job = observeChild(spawn(command.join(' '), {
    shell: viameConstants.shell,
    cwd: indexDir,
  }));

  const jobBase: DesktopJob = {
    key: `search_index_${job.pid}_${jobWorkDir}`,
    command: command.join(' '),
    jobType: 'pipeline',
    pid: job.pid,
    args,
    title: `Build search index (${method})`,
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
      const indexMeta: SearchIndexMeta = {
        version: 1,
        method,
        fps: meta.fps,
        datasets: [datasetId],
        createdAt: (new Date()).toISOString(),
      };
      try {
        await fs.writeJson(npath.join(indexDir, IndexMetaFileName), indexMeta, { spaces: 2 });
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

  /** Index directory currently opened in the service, if any. */
  private currentIndexDir: string | null = null;

  // First open loads the descriptor index + pipeline; queries train SVMs.
  private readonly requestTimeoutMs = 300000;

  isReady(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  openIndexDir(): string | null {
    return this.isReady() ? this.currentIndexDir : null;
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

  /** Open an index, closing any previously open one (one postgres at a time). */
  async openIndex(settings: Settings, indexDir: string): Promise<void> {
    await this.ensureStarted(settings);
    if (this.currentIndexDir === indexDir) {
      return;
    }
    if (this.currentIndexDir) {
      await this.closeIndex();
    }
    const response = await this.sendRequest({ command: 'open_index', index_dir: indexDir }, 'Open index');
    QueryServiceManager.check(response, 'Opening the search index');
    this.currentIndexDir = indexDir;
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

  async refine(positiveIds: number[], negativeIds: number[]): Promise<ServiceResponse> {
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

  async closeIndex(): Promise<void> {
    if (!this.isReady()) {
      this.currentIndexDir = null;
      return;
    }
    try {
      await this.sendRequest({ command: 'close_index' }, 'Close index');
    } catch {
      // best effort - shutting the process down also stops postgres
    }
    this.currentIndexDir = null;
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
    this.currentIndexDir = null;
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
 * Delete a dataset's search index from disk, closing it first if it is the
 * one currently open in the query service.
 */
async function deleteIndex(settings: Settings, datasetId: string): Promise<void> {
  const indexDir = getIndexDir(settings, datasetId);
  const manager = getQueryServiceManager();
  if (manager.openIndexDir() === indexDir) {
    await manager.closeIndex();
  }
  await fs.remove(indexDir);
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
  if (!manager.isReady() || !manager.openIndexDir()) {
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
  buildIndex,
  deleteIndex,
  exportSearchModel,
};
