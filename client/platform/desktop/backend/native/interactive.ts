/**
 * Interactive Service Manager for Desktop
 *
 * Manages ONE persistent Python subprocess (viame.core.interactive_service) that
 * hosts both interactive segmentation (point/SAM, text query, stereo point
 * segmentation) and interactive stereo (enable, transfer, measure, dense
 * disparity). Merging them into a single process lets stereo point-segmentation
 * reuse the same stereo backend that interactive-stereo mode loads, instead of
 * loading the stereo model twice.
 *
 * The process is spawned lazily on first use of either feature, and each
 * feature's models load lazily on first relevant request (segmentation on the
 * first predict, stereo on the first enable), so nothing heavy loads
 * unnecessarily. Separate, unmodified VIAME config files drive each feature.
 */

import OS from 'os';
import { spawn, ChildProcess } from 'child_process';
import npath from 'path';
import readline from 'readline';
import { EventEmitter } from 'events';
import { Settings } from 'platform/desktop/constants';
import { observeChild } from './processManager';
import {
  SegmentationStereoSegmentRequest,
  SegmentationStereoSegmentResponse,
  SegmentationPredictRequest,
  SegmentationPredictResponse,
} from './segmentation';
import {
  StereoCalibration,
  StereoSetFrameRequest,
  StereoSetFrameResponse,
  StereoTransferLineRequest,
  StereoTransferLineResponse,
  StereoMeasureLineRequest,
  StereoMeasureLineResponse,
  StereoAggregateLengthsRequest,
  StereoAggregateLengthsResponse,
  StereoTransferPointsRequest,
  StereoTransferPointsResponse,
  StereoStatusResponse,
  StereoMeasurement,
} from './stereo';

/** Error headline shown to users when the interactive service fails to load. */
export const INTERACTIVE_LOAD_ERROR_MESSAGE = 'Unable to load the interactive service.';

interface InteractiveLoadErrorContext {
  reason: string;
  viamePath?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stderrLines?: string[];
  cause?: string;
}

export function formatInteractiveLoadError(context: InteractiveLoadErrorContext): string {
  const parts: string[] = [INTERACTIVE_LOAD_ERROR_MESSAGE, context.reason];
  if (context.cause) {
    parts.push(`Cause: ${context.cause}`);
  }
  if (context.exitCode != null || context.signal) {
    const details: string[] = [];
    if (context.exitCode != null) details.push(`exit code ${context.exitCode}`);
    if (context.signal) details.push(`signal ${context.signal}`);
    parts.push(`Process ended (${details.join(', ')}).`);
  }
  if (context.viamePath) {
    parts.push(`VIAME path: ${context.viamePath}`);
  }
  const stderr = context.stderrLines?.filter((line) => line.trim()).slice(-8);
  if (stderr?.length) {
    parts.push('Recent service output:');
    parts.push(...stderr.map((line) => `  ${line}`));
  }
  parts.push('Verify VIAME is installed and the path is set correctly in Settings.');
  return parts.join('\n');
}

function formatStereoEnableError(
  error: string,
  options: { calibrationFile?: string; viamePath?: string },
): string {
  const parts = [error];
  if (options.calibrationFile) {
    parts.push(`Calibration file: ${options.calibrationFile}`);
  }
  if (options.viamePath) {
    parts.push(`VIAME path: ${options.viamePath}`);
  }
  return parts.join('\n');
}

/** Loose shape of a JSON response line from the Python service. */
interface ServiceResponse {
  id: string;
  success?: boolean;
  error?: string;
  type?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface PendingRequest {
  resolve: (response: ServiceResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class InteractiveServiceManager extends EventEmitter {
  private process: ChildProcess | null = null;

  private readline: readline.Interface | null = null;

  private pendingRequests: Map<string, PendingRequest> = new Map();

  private isStarting = false;

  private startPromise: Promise<void> | null = null;

  private settings: Settings | null = null;

  private requestCounter = 0;

  /** Whether interactive stereo has been enabled in the running process. */
  private stereoEnabled = false;

  /** Whether the segmentation backend + model have been initialized (warmed). */
  private segInitialized = false;

  // Generous timeout: the first request of each feature lazily loads its model.
  private readonly requestTimeoutMs = 300000;

  /** Is the shared process running? */
  isReady(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  /** Is interactive stereo currently enabled? */
  isEnabled(): boolean {
    return this.stereoEnabled && this.isReady();
  }

  /** Has the segmentation backend/model been initialized (warmed up)? */
  isSegmentationReady(): boolean {
    return this.segInitialized && this.isReady();
  }

  private generateRequestId(): string {
    this.requestCounter += 1;
    return `req_${Date.now()}_${this.requestCounter}`;
  }

  /**
   * Ensure the shared Python process is running. Idempotent and de-duplicates
   * concurrent callers. Spawning loads plugins (the slow, feature-agnostic step)
   * but no models; models load lazily on first relevant request.
   */
  async ensureStarted(settings: Settings): Promise<void> {
    if (this.isReady()) {
      return;
    }
    if (this.isStarting && this.startPromise) {
      await this.startPromise;
      return;
    }
    this.isStarting = true;
    this.settings = settings;
    this.startPromise = this.doStart(settings);
    try {
      await this.startPromise;
    } finally {
      this.isStarting = false;
    }
  }

  private async doStart(settings: Settings): Promise<void> {
    // Clean up any defunct process first.
    await this.shutdown();

    return new Promise((resolve, reject) => {
      const isWin32 = OS.platform() === 'win32';
      const viameSetup = npath.join(
        settings.viamePath,
        isWin32 ? 'setup_viame.bat' : 'setup_viame.sh',
      );
      const pipelines = npath.join(settings.viamePath, 'configs', 'pipelines');
      const segConfig = npath.join(pipelines, 'interactive_segmenter_default.conf');
      const stereoConfig = npath.join(pipelines, 'interactive_stereo_default.conf');

      const pyCommand = [
        'python -m viame.core.interactive_service',
        `--segmentation-config "${segConfig}"`,
        `--stereo-config "${stereoConfig}"`,
      ].join(' ');

      let command: string;
      let shellOption: string | boolean;
      if (isWin32) {
        command = [`"${viameSetup}"`, '&&', pyCommand].join(' ');
        shellOption = true;
      } else {
        command = [`. "${viameSetup}"`, '&&', pyCommand].join(' ');
        shellOption = '/bin/bash';
      }

      console.log('[Interactive] Starting interactive service...');
      console.log(`[Interactive] Command: ${command}`);

      const stderrLines: string[] = [];
      const maxStderrLines = 20;

      this.process = observeChild(spawn(command, {
        shell: shellOption,
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
            console.log(`[Interactive] ${message}`);
            stderrLines.push(message);
            if (stderrLines.length > maxStderrLines) {
              stderrLines.shift();
            }
            // Ready once plugins are loaded and the stdin loop is live (before
            // any model loads — those happen lazily on first request).
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

      const rejectStartup = (context: InteractiveLoadErrorContext) => {
        if (!this.isStarting) {
          return;
        }
        this.isStarting = false;
        if (startupTimeout) {
          clearTimeout(startupTimeout);
          startupTimeout = null;
        }
        this.shutdown().finally(() => reject(new Error(formatInteractiveLoadError({
          ...context,
          viamePath: context.viamePath ?? settings.viamePath,
          stderrLines: context.stderrLines ?? stderrLines,
        }))));
      };

      this.process.on('exit', (code, signal) => {
        console.log(`[Interactive] Process exited with code ${code}, signal ${signal}`);
        this.cleanup();
        if (this.isStarting) {
          rejectStartup({
            reason: 'The service process exited before it became ready.',
            exitCode: code,
            signal,
          });
        }
      });

      this.process.on('error', (err) => {
        console.error('[Interactive] Process error:', err);
        this.cleanup();
        if (this.isStarting) {
          rejectStartup({
            reason: 'Failed to start the service process.',
            cause: err.message,
          });
        }
      });

      // Startup covers plugin loading only (~tens of seconds), not models.
      startupTimeout = setTimeout(() => {
        rejectStartup({
          reason: 'The service did not become ready within 5 minutes.',
        });
      }, 300000);
    });
  }

  /** Route an incoming JSON line to its pending request, or emit async events. */
  private handleResponse(line: string): void {
    let response: ServiceResponse;
    try {
      response = JSON.parse(line) as ServiceResponse;
    } catch (err) {
      console.error('[Interactive] Failed to parse response:', line, err);
      return;
    }
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(response.id);
      pending.resolve(response);
    } else if (response.type === 'disparity_ready') {
      this.emit('disparity_ready', response);
    } else if (response.type === 'disparity_error') {
      this.emit('disparity_error', response);
    } else {
      console.warn(`[Interactive] Received response for unknown request: ${response.id}`);
    }
  }

  /** Write a command to the process and resolve with the matching response. */
  private sendRequest(payload: Record<string, unknown>, timeoutLabel: string): Promise<ServiceResponse> {
    if (!this.isReady() || !this.process?.stdin) {
      return Promise.reject(new Error('Interactive service is not running'));
    }
    const id = this.generateRequestId();
    const fullRequest = { ...payload, id };
    return new Promise<ServiceResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`${timeoutLabel} request timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      const requestLine = `${JSON.stringify(fullRequest)}\n`;
      this.process!.stdin!.write(requestLine, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          reject(err);
        }
      });
    });
  }

  // ----------------------------------------------------- segmentation API

  /**
   * Start the shared process and initialize + warm up the segmentation models.
   * Called when the user enters point-segmentation mode, so SAM loads on mode
   * entry rather than on the first click. Idempotent.
   */
  async initialize(settings: Settings): Promise<void> {
    await this.ensureStarted(settings);
    if (!this.segInitialized) {
      const response = await this.sendRequest({ command: 'init_segmentation' }, 'Segmentation init');
      if (!response.success) {
        throw new Error(response.error || 'Failed to initialize segmentation');
      }
      this.segInitialized = true;
    }
  }

  async predict(request: SegmentationPredictRequest): Promise<SegmentationPredictResponse> {
    if (!request.imagePath) {
      throw new Error('imagePath is required for segmentation prediction');
    }
    const response = await this.sendRequest({
      command: 'predict',
      image_path: request.imagePath,
      points: request.points,
      point_labels: request.pointLabels,
      mask_input: request.maskInput,
      multimask_output: request.multimaskOutput ?? false,
      frame_time: request.frameTime,
    }, 'Segmentation predict');
    return response as unknown as SegmentationPredictResponse;
  }

  async stereoSegment(
    request: SegmentationStereoSegmentRequest,
  ): Promise<SegmentationStereoSegmentResponse> {
    const r = await this.sendRequest({
      command: 'stereo_segment',
      polygon: request.polygon,
      points: request.points,
      point_labels: request.pointLabels,
      source_image_path: request.sourceImagePath,
      other_image_path: request.otherImagePath,
      calibration_file: request.calibrationFile,
      frame_time: request.frameTime,
    }, 'Segmentation stereo_segment');
    return {
      id: r.id,
      success: r.success,
      error: r.error,
      polygon: r.polygon,
      bounds: r.bounds,
      score: r.score,
      seedPoints: r.seed_points as [number, number][] | undefined,
      seedLabels: r.seed_labels as number[] | undefined,
      generateLine: r.generate_line as boolean | undefined,
      lineSource: r.line_source as [[number, number], [number, number]] | undefined,
      lineOther: r.line_other as [[number, number], [number, number]] | undefined,
      measurement: r.measurement as StereoMeasurement | undefined,
    };
  }

  async setImage(imagePath: string): Promise<void> {
    await this.sendRequest({ command: 'set_image', image_path: imagePath }, 'set_image');
  }

  async clearImage(): Promise<void> {
    if (!this.isReady()) {
      return;
    }
    await this.sendRequest({ command: 'clear_image' }, 'clear_image');
  }

  /**
   * Release segmentation resources without killing the shared process.
   * Stereo may still be enabled in the same backend.
   */
  async shutdownSegmentation(): Promise<{ success: boolean }> {
    if (!this.isReady()) {
      this.segInitialized = false;
      return { success: true };
    }
    try {
      await this.clearImage();
    } catch {
      // Best-effort teardown; still mark segmentation as not ready.
    }
    this.segInitialized = false;
    return { success: true };
  }

  // ----------------------------------------------------------- stereo API

  async enable(
    settings: Settings,
    calibration?: StereoCalibration,
    calibrationFile?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureStarted(settings);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
    try {
      const response = await this.sendRequest({
        command: 'enable',
        calibration,
        calibration_file: calibrationFile,
      }, 'Stereo enable');
      if (response.success) {
        this.stereoEnabled = true;
        return { success: true };
      }
      return {
        success: false,
        error: formatStereoEnableError(
          response.error || 'Failed to enable stereo service',
          { calibrationFile, viamePath: settings.viamePath },
        ),
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Disable interactive stereo. Unlike the old standalone manager this does NOT
   * kill the process (segmentation may still be in use); it just tells the
   * backend to disable and marks stereo disabled.
   */
  async disable(): Promise<{ success: boolean }> {
    if (!this.stereoEnabled || !this.isReady()) {
      this.stereoEnabled = false;
      return { success: true };
    }
    try {
      await this.sendRequest({ command: 'disable' }, 'Stereo disable');
    } catch {
      // ignore — disabling is best-effort
    }
    this.stereoEnabled = false;
    return { success: true };
  }

  async setCalibration(calibration: StereoCalibration): Promise<void> {
    await this.sendRequest({ command: 'set_calibration', calibration }, 'set_calibration');
  }

  async setFrame(request: StereoSetFrameRequest): Promise<StereoSetFrameResponse> {
    if (!this.isEnabled()) {
      return {
        id: '', success: false, error: 'Stereo service is not enabled', disparityReady: false,
      };
    }
    const r = await this.sendRequest({
      command: 'set_frame',
      left_image_path: request.leftImagePath,
      right_image_path: request.rightImagePath,
      frame_time: request.frameTime,
    }, 'set_frame');
    return {
      id: r.id,
      success: r.success,
      error: r.error,
      disparityReady: r.disparity_ready || false,
      message: r.message,
    };
  }

  async getStatus(): Promise<StereoStatusResponse> {
    if (!this.isReady()) {
      return {
        id: '', success: true, enabled: false, disparityReady: false, hasCalibration: false,
      };
    }
    const r = await this.sendRequest({ command: 'get_status' }, 'get_status');
    return {
      id: r.id,
      success: r.success,
      enabled: r.enabled || false,
      disparityReady: r.disparity_ready || false,
      computing: r.computing,
      currentLeftPath: r.current_left_path,
      currentRightPath: r.current_right_path,
      hasCalibration: r.has_calibration || false,
    };
  }

  async transferLine(request: StereoTransferLineRequest): Promise<StereoTransferLineResponse> {
    if (!this.isEnabled()) {
      return { id: '', success: false, error: 'Stereo service is not enabled' };
    }
    const r = await this.sendRequest({ command: 'transfer_line', line: request.line }, 'transfer_line');
    return {
      id: r.id,
      success: r.success,
      error: r.error,
      transferredLine: r.transferred_line,
      originalLine: r.original_line,
      length: r.length,
      measurement: r.measurement,
      depthInfo: r.depth_info ? {
        depthPoint1: r.depth_info.depth_point1,
        depthPoint2: r.depth_info.depth_point2,
        disparityPoint1: r.depth_info.disparity_point1,
        disparityPoint2: r.depth_info.disparity_point2,
      } : undefined,
    };
  }

  async transferPoints(request: StereoTransferPointsRequest): Promise<StereoTransferPointsResponse> {
    if (!this.isEnabled()) {
      return { id: '', success: false, error: 'Stereo service is not enabled' };
    }
    const r = await this.sendRequest({ command: 'transfer_points', points: request.points }, 'transfer_points');
    return {
      id: r.id,
      success: r.success,
      error: r.error,
      transferredPoints: r.transferred_points,
      originalPoints: r.original_points,
      disparityValues: r.disparity_values,
    };
  }

  async measureLine(request: StereoMeasureLineRequest): Promise<StereoMeasureLineResponse> {
    if (!this.isEnabled()) {
      return { id: '', success: false, error: 'Stereo service is not enabled' };
    }
    const r = await this.sendRequest({
      command: 'measure_line',
      left_line: request.leftLine,
      right_line: request.rightLine,
    }, 'measure_line');
    return {
      id: r.id, success: r.success, error: r.error, length: r.length, measurement: r.measurement,
    };
  }

  async aggregateLengths(request: StereoAggregateLengthsRequest): Promise<StereoAggregateLengthsResponse> {
    if (!this.isEnabled()) {
      return { id: '', success: false, error: 'Stereo service is not enabled' };
    }
    const r = await this.sendRequest({
      command: 'aggregate_lengths',
      lengths: request.lengths,
      method: request.method || 'average',
    }, 'aggregate_lengths');
    return {
      id: r.id, success: r.success, error: r.error, avgLength: r.avg_length,
    };
  }

  // ------------------------------------------------------------ lifecycle

  private cleanup(): void {
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Interactive service terminated'));
    });
    this.pendingRequests.clear();

    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }

    this.process = null;
    this.stereoEnabled = false;
    this.segInitialized = false;
    this.emit('shutdown');
  }

  async shutdown(): Promise<void> {
    if (!this.process) {
      return;
    }
    console.log('[Interactive] Shutting down interactive service...');
    await new Promise<void>((resolve) => {
      const reqId = this.generateRequestId();
      const request = { id: reqId, command: 'shutdown' };
      if (this.process?.stdin?.writable) {
        this.process.stdin.write(`${JSON.stringify(request)}\n`);
      }
      const timeoutId = setTimeout(() => {
        if (this.process) {
          console.log('[Interactive] Force killing interactive service...');
          this.process.kill('SIGTERM');
        }
        this.cleanup();
        resolve();
      }, 5000);
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
let serviceManager: InteractiveServiceManager | null = null;

export function getInteractiveServiceManager(): InteractiveServiceManager {
  if (!serviceManager) {
    serviceManager = new InteractiveServiceManager();
  }
  return serviceManager;
}

export async function shutdownInteractiveService(): Promise<void> {
  if (serviceManager) {
    await serviceManager.shutdown();
    serviceManager = null;
  }
}
