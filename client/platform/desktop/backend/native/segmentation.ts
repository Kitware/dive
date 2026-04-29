/**
 * Interactive Segmentation Service Manager for Desktop
 *
 * Manages a persistent Python subprocess that keeps the segmentation model loaded in memory
 * for fast interactive segmentation from point clicks.
 */

import { spawn, ChildProcess } from 'child_process';
import npath from 'path';
import readline from 'readline';
import { EventEmitter } from 'events';
import { Settings } from 'platform/desktop/constants';
import { observeChild } from './processManager';

/** Error message shown to users when segmentation fails to load */
export const SEGMENTATION_LOAD_ERROR_MESSAGE = 'Unable to load segmentation module';

/** Request to the segmentation service */
export interface SegmentationInternalPredictRequest {
  /** Unique request ID for correlation */
  id: string;
  /** Path to the image file */
  imagePath: string;
  /** Point coordinates as [x, y] pairs */
  points: [number, number][];
  /** Point labels: 1 for foreground, 0 for background */
  pointLabels: number[];
  /** Optional low-res mask from previous prediction for refinement */
  maskInput?: number[][];
  /** Whether to return multiple mask options */
  multimaskOutput?: boolean;
}

/** Response from the segmentation service */
export interface SegmentationInternalPredictResponse {
  /** Request ID for correlation */
  id: string;
  /** Whether the prediction succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Polygon coordinates as [x, y] pairs */
  polygon?: [number, number][];
  /** Bounding box [x_min, y_min, x_max, y_max] */
  bounds?: [number, number, number, number];
  /** Quality score from segmentation model */
  score?: number;
  /** Low-res mask for subsequent refinement */
  lowResMask?: number[][];
  /** Mask dimensions [height, width] */
  maskShape?: [number, number];
}

interface PendingRequest {
  resolve: (response: SegmentationInternalPredictResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * Segmentation Service Manager
 *
 * Manages a persistent Python subprocess for interactive segmentation inference.
 * The service is started on-demand and kept alive for the session.
 */
export class SegmentationServiceManager extends EventEmitter {
  private process: ChildProcess | null = null;

  private readline: readline.Interface | null = null;

  private pendingRequests: Map<string, PendingRequest> = new Map();

  private isInitializing = false;

  private initPromise: Promise<void> | null = null;

  private settings: Settings | null = null;

  private requestCounter = 0;

  private readonly requestTimeoutMs = 30000; // 30 second timeout

  /**
   * Initialize the segmentation service with the given settings.
   * This spawns the Python process and loads the segmentation model.
   * The model stays loaded for the entire session to avoid reload delays.
   */
  async initialize(settings: Settings): Promise<void> {
    // If already initialized and running, return immediately
    // This keeps the model loaded between activations
    if (this.isReady()) {
      console.log('[Segmentation] Service already running, skipping initialization');
      return undefined;
    }

    // If currently initializing, wait for it
    if (this.isInitializing && this.initPromise) {
      await this.initPromise;
      return undefined;
    }

    this.isInitializing = true;
    this.settings = settings;

    this.initPromise = this._doInitialize(settings);
    try {
      await this.initPromise;
    } finally {
      this.isInitializing = false;
    }
    return undefined;
  }

  private async _doInitialize(settings: Settings): Promise<void> {
    // Clean up any existing process
    await this.shutdown();

    return new Promise((resolve, reject) => {
      const viameSetup = npath.join(settings.viamePath, 'setup_viame.sh');

      const configPath = npath.join(
        settings.viamePath, 'configs', 'pipelines', 'interactive_segmenter_default.conf',
      );

      // Build the command to run the interactive segmentation service
      const command = [
        `. "${viameSetup}"`,
        '&&',
        'python -m viame.core.interactive_segmentation',
        `--config "${configPath}"`,
      ].join(' ');

      console.log('[Segmentation] Starting interactive segmentation service...');
      console.log(`[Segmentation] Command: ${command}`);

      this.process = observeChild(spawn(command, {
        shell: '/bin/bash',
        stdio: ['pipe', 'pipe', 'pipe'],
      }));

      // Set up readline for stdout (JSON responses)
      if (this.process.stdout) {
        this.readline = readline.createInterface({
          input: this.process.stdout,
          crlfDelay: Infinity,
        });

        this.readline.on('line', (line) => {
          this.handleResponse(line);
        });
      }

      // Log stderr (diagnostic messages)
      if (this.process.stderr) {
        this.process.stderr.on('data', (data: Buffer) => {
          const message = data.toString().trim();
          if (message) {
            console.log(`[Segmentation] ${message}`);
            // Detect successful initialization
            if (message.includes('model initialized successfully')) {
              resolve();
            }
          }
        });
      }

      // Handle process exit
      this.process.on('exit', (code, signal) => {
        console.log(`[Segmentation] Process exited with code ${code}, signal ${signal}`);
        this.cleanup();
        if (this.isInitializing) {
          reject(new Error(SEGMENTATION_LOAD_ERROR_MESSAGE));
        }
      });

      this.process.on('error', (err) => {
        console.error('[Segmentation] Process error:', err);
        this.cleanup();
        if (this.isInitializing) {
          reject(new Error(SEGMENTATION_LOAD_ERROR_MESSAGE));
        }
      });

      // Timeout for initialization (60 seconds for model loading)
      setTimeout(() => {
        if (this.isInitializing) {
          reject(new Error(SEGMENTATION_LOAD_ERROR_MESSAGE));
        }
      }, 60000);
    });
  }

  /**
   * Check if the service is ready for requests
   */
  isReady(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  /**
   * Generate a unique request ID
   */
  private generateRequestId(): string {
    this.requestCounter += 1;
    return `req_${Date.now()}_${this.requestCounter}`;
  }

  /**
   * Handle a response line from the segmentation service
   */
  private handleResponse(line: string): void {
    try {
      const response = JSON.parse(line) as SegmentationInternalPredictResponse;
      const pending = this.pendingRequests.get(response.id);

      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.id);
        pending.resolve(response);
      } else {
        console.warn(`[Segmentation] Received response for unknown request: ${response.id}`);
      }
    } catch (err) {
      console.error('[Segmentation] Failed to parse response:', line, err);
    }
  }

  /**
   * Send a predict request to the segmentation service
   */
  async predict(request: Omit<SegmentationInternalPredictRequest, 'id'>): Promise<SegmentationInternalPredictResponse> {
    if (!this.isReady()) {
      throw new Error('Segmentation service is not ready. Call initialize() first.');
    }

    if (!this.process?.stdin) {
      throw new Error('Segmentation service stdin is not available');
    }

    if (!request.imagePath) {
      throw new Error('imagePath is required for segmentation prediction');
    }

    const id = this.generateRequestId();
    const fullRequest = {
      id,
      command: 'predict',
      image_path: request.imagePath,
      points: request.points,
      point_labels: request.pointLabels,
      mask_input: request.maskInput,
      multimask_output: request.multimaskOutput ?? false,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Segmentation predict request timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      // Send the request as JSON line
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

  /**
   * Pre-load an image for multiple predictions (optional optimization)
   */
  async setImage(imagePath: string): Promise<void> {
    if (!this.isReady()) {
      throw new Error('Segmentation service is not ready');
    }

    const id = this.generateRequestId();
    const request = {
      id,
      command: 'set_image',
      image_path: imagePath,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('set_image request timed out'));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, {
        resolve: () => resolve(),
        reject,
        timeout,
      });

      const requestLine = `${JSON.stringify(request)}\n`;
      this.process!.stdin!.write(requestLine);
    });
  }

  /**
   * Clear the cached image
   */
  async clearImage(): Promise<void> {
    if (!this.isReady()) {
      return undefined; // Nothing to clear
    }

    const id = this.generateRequestId();
    const request = {
      id,
      command: 'clear_image',
    };

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('clear_image request timed out'));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, {
        resolve: () => resolve(),
        reject,
        timeout,
      });

      const requestLine = `${JSON.stringify(request)}\n`;
      this.process!.stdin!.write(requestLine);
    });
    return undefined;
  }

  /**
   * Send a text query request for open-vocabulary detection/segmentation
   */
  async textQuery(request: {
    imagePath: string;
    text: string;
    boxThreshold?: number;
    maxDetections?: number;
    boxes?: [number, number, number, number][];
    points?: [number, number][];
    pointLabels?: number[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }): Promise<any> {
    if (!this.isReady()) {
      throw new Error('Segmentation service is not ready. Call initialize() first.');
    }

    if (!this.process?.stdin) {
      throw new Error('Segmentation service stdin is not available');
    }

    const id = this.generateRequestId();
    const fullRequest = {
      id,
      command: 'text_query',
      image_path: request.imagePath,
      text: request.text,
      box_threshold: request.boxThreshold ?? 0.3,
      max_detections: request.maxDetections ?? 10,
      boxes: request.boxes,
      points: request.points,
      point_labels: request.pointLabels,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Text query request timed out after ${this.requestTimeoutMs}ms`));
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

  /**
   * Refine existing detections with additional prompts
   */
  async refineDetections(request: {
    imagePath: string;
    detections: {
      box: [number, number, number, number];
      polygon?: [number, number][];
      score: number;
      label: string;
    }[];
    points?: [number, number][];
    pointLabels?: number[];
    refineMasks?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }): Promise<any> {
    if (!this.isReady()) {
      throw new Error('Segmentation service is not ready. Call initialize() first.');
    }

    if (!this.process?.stdin) {
      throw new Error('Segmentation service stdin is not available');
    }

    const id = this.generateRequestId();
    const fullRequest = {
      id,
      command: 'refine',
      image_path: request.imagePath,
      detections: request.detections,
      points: request.points,
      point_labels: request.pointLabels,
      refine_masks: request.refineMasks ?? true,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Refine request timed out after ${this.requestTimeoutMs}ms`));
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

  /**
   * Clean up internal state after process exits
   */
  private cleanup(): void {
    // Reject all pending requests
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Segmentation service terminated'));
    });
    this.pendingRequests.clear();

    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }

    this.process = null;
    this.emit('shutdown');
  }

  /**
   * Gracefully shutdown the segmentation service
   */
  async shutdown(): Promise<void> {
    if (!this.process) {
      return undefined;
    }

    console.log('[Segmentation] Shutting down segmentation service...');

    await new Promise<void>((resolve) => {
      // Send shutdown command
      const reqId = this.generateRequestId();
      const request = { id: reqId, command: 'shutdown' };

      if (this.process?.stdin?.writable) {
        this.process.stdin.write(`${JSON.stringify(request)}\n`);
      }

      // Wait for process to exit or timeout
      const timeoutId = setTimeout(() => {
        if (this.process) {
          console.log('[Segmentation] Force killing segmentation service...');
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
    return undefined;
  }
}

// Singleton instance
let serviceManager: SegmentationServiceManager | null = null;

/**
 * Get the segmentation service manager singleton
 */
export function getSegmentationServiceManager(): SegmentationServiceManager {
  if (!serviceManager) {
    serviceManager = new SegmentationServiceManager();
  }
  return serviceManager;
}

/**
 * Shutdown the segmentation service (call on app close)
 */
export async function shutdownSegmentationService(): Promise<void> {
  if (serviceManager) {
    await serviceManager.shutdown();
    serviceManager = null;
  }
}

// Export type aliases for generic naming
export type SegmentationPredictRequest = Omit<SegmentationInternalPredictRequest, 'id'>;
export type SegmentationPredictResponse = SegmentationInternalPredictResponse;
