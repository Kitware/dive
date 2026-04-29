/**
 * Interactive Stereo Service Manager for Desktop
 *
 * Manages a persistent Python subprocess that keeps the interactive stereo model loaded
 * for fast interactive stereo annotation. When enabled, the service proactively computes
 * disparity maps when the user navigates to new frames, so annotation transfers are instant.
 */

import { spawn, ChildProcess } from 'child_process';
import npath from 'path';
import readline from 'readline';
import { EventEmitter } from 'events';
import { Settings } from 'platform/desktop/constants';
import { observeChild } from './processManager';

/** Error message shown to users when stereo service fails to load */
export const STEREO_LOAD_ERROR_MESSAGE = 'Unable to load stereo service';

/** Calibration data for stereo depth computation */
export interface StereoCalibration {
  fx_left: number;
  fy_left?: number;
  cx_left: number;
  cy_left: number;
  T: [number, number, number];
}

/** Request to set the current stereo frame */
export interface StereoSetFrameRequest {
  leftImagePath: string;
  rightImagePath: string;
}

/** Response from set frame request */
export interface StereoSetFrameResponse {
  id: string;
  success: boolean;
  error?: string;
  disparityReady: boolean;
  message?: string;
}

/** Request to transfer a line from left to right image */
export interface StereoTransferLineRequest {
  line: [[number, number], [number, number]];
}

/** Response from transfer line request */
export interface StereoTransferLineResponse {
  id: string;
  success: boolean;
  error?: string;
  transferredLine?: [[number, number], [number, number]];
  originalLine?: [[number, number], [number, number]];
  depthInfo?: {
    depthPoint1: number | null;
    depthPoint2: number | null;
    disparityPoint1: number;
    disparityPoint2: number;
  };
}

/** Request to transfer multiple points */
export interface StereoTransferPointsRequest {
  points: [number, number][];
}

/** Response from transfer points request */
export interface StereoTransferPointsResponse {
  id: string;
  success: boolean;
  error?: string;
  transferredPoints?: [number, number][];
  originalPoints?: [number, number][];
  disparityValues?: number[];
}

/** Status response from the stereo service */
export interface StereoStatusResponse {
  id: string;
  success: boolean;
  enabled: boolean;
  disparityReady: boolean;
  computing?: boolean;
  currentLeftPath?: string;
  currentRightPath?: string;
  hasCalibration: boolean;
}

// Generic response type for internal use
interface StereoResponse {
  id: string;
  success: boolean;
  error?: string;
  message?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface PendingRequest {
  resolve: (response: StereoResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * Stereo Service Manager
 *
 * Manages a persistent Python subprocess for interactive stereo disparity computation.
 * The service is started when enabled and kept alive until disabled.
 */
export class StereoServiceManager extends EventEmitter {
  private process: ChildProcess | null = null;

  private readline: readline.Interface | null = null;

  private pendingRequests: Map<string, PendingRequest> = new Map();

  private isInitializing = false;

  private initPromise: Promise<void> | null = null;

  private settings: Settings | null = null;

  private requestCounter = 0;

  private enabled = false;

  private readonly requestTimeoutMs = 60000; // 60 second timeout (disparity can take time)

  /**
   * Enable the stereo service with the given settings and calibration.
   * This spawns the Python process and loads the interactive stereo model.
   */
  async enable(settings: Settings, calibration?: StereoCalibration): Promise<{ success: boolean; error?: string }> {
    // If already enabled and running, just update calibration if provided
    if (this.enabled && this.isReady()) {
      console.log('[Stereo] Service already running');
      if (calibration) {
        await this.setCalibration(calibration);
      }
      return { success: true };
    }

    // If currently initializing, wait for it
    if (this.isInitializing && this.initPromise) {
      await this.initPromise;
      return { success: true };
    }

    this.isInitializing = true;
    this.settings = settings;

    try {
      this.initPromise = this._doInitialize(settings, calibration);
      await this.initPromise;
      this.enabled = true;
      return { success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return { success: false, error: errorMessage };
    } finally {
      this.isInitializing = false;
    }
  }

  private async _doInitialize(settings: Settings, calibration?: StereoCalibration): Promise<void> {
    // Clean up any existing process
    await this.shutdown();

    return new Promise((resolve, reject) => {
      const viameSetup = npath.join(settings.viamePath, 'setup_viame.sh');
      const configPath = npath.join(settings.viamePath, 'configs', 'pipelines', 'interactive_stereo_default.conf');

      // Build the command to run the interactive stereo service
      const command = [
        `. "${viameSetup}"`,
        '&&',
        'python -m viame.core.interactive_stereo',
        `--config "${configPath}"`,
      ].join(' ');

      console.log('[Stereo] Starting interactive stereo service...');
      console.log(`[Stereo] Command: ${command}`);

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

      let initialized = false;

      // Log stderr (diagnostic messages)
      if (this.process.stderr) {
        this.process.stderr.on('data', (data: Buffer) => {
          const message = data.toString().trim();
          if (message) {
            console.log(`[Stereo] ${message}`);
            // Detect successful startup (service is waiting for requests)
            if (message.includes('Service started, waiting for requests')) {
              // Now send the enable command with calibration
              this.sendEnableCommand(calibration)
                .then(() => {
                  initialized = true;
                  resolve();
                })
                .catch(reject);
            }
          }
        });
      }

      // Handle process exit
      this.process.on('exit', (code, signal) => {
        console.log(`[Stereo] Process exited with code ${code}, signal ${signal}`);
        this.cleanup();
        if (this.isInitializing && !initialized) {
          reject(new Error(STEREO_LOAD_ERROR_MESSAGE));
        }
      });

      this.process.on('error', (err) => {
        console.error('[Stereo] Process error:', err);
        this.cleanup();
        if (this.isInitializing) {
          reject(new Error(STEREO_LOAD_ERROR_MESSAGE));
        }
      });

      // Timeout for initialization (90 seconds for model loading)
      setTimeout(() => {
        if (this.isInitializing && !initialized) {
          reject(new Error(STEREO_LOAD_ERROR_MESSAGE));
        }
      }, 90000);
    });
  }

  /**
   * Send the enable command to the Python service
   */
  private async sendEnableCommand(calibration?: StereoCalibration): Promise<void> {
    const id = this.generateRequestId();
    const request = {
      id,
      command: 'enable',
      calibration,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Enable command timed out'));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, {
        resolve: (response) => {
          if (response.success) {
            resolve();
          } else {
            reject(new Error(response.error || 'Failed to enable stereo service'));
          }
        },
        reject,
        timeout,
      });

      const requestLine = `${JSON.stringify(request)}\n`;
      this.process!.stdin!.write(requestLine);
    });
  }

  /**
   * Disable the stereo service and unload the model
   */
  async disable(): Promise<{ success: boolean }> {
    if (!this.enabled || !this.isReady()) {
      this.enabled = false;
      return { success: true };
    }

    try {
      const id = this.generateRequestId();
      const request = { id, command: 'disable' };

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.pendingRequests.delete(id);
          resolve();
        }, 5000);

        this.pendingRequests.set(id, {
          resolve: () => resolve(),
          reject: () => resolve(),
          timeout,
        });

        const requestLine = `${JSON.stringify(request)}\n`;
        this.process!.stdin!.write(requestLine);
      });

      await this.shutdown();
      this.enabled = false;
      return { success: true };
    } catch {
      this.enabled = false;
      return { success: true };
    }
  }

  /**
   * Check if the service is ready for requests
   */
  isReady(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  /**
   * Check if the service is enabled
   */
  isEnabled(): boolean {
    return this.enabled && this.isReady();
  }

  /**
   * Generate a unique request ID
   */
  private generateRequestId(): string {
    this.requestCounter += 1;
    return `req_${Date.now()}_${this.requestCounter}`;
  }

  /**
   * Handle a response line from the stereo service
   */
  private handleResponse(line: string): void {
    try {
      const response = JSON.parse(line) as StereoResponse;
      const pending = this.pendingRequests.get(response.id);

      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.id);
        pending.resolve(response);
      } else if (response.type === 'disparity_ready') {
        // Async notification that disparity is ready
        this.emit('disparity_ready', response);
      } else if (response.type === 'disparity_error') {
        this.emit('disparity_error', response);
      } else {
        console.warn(`[Stereo] Received response for unknown request: ${response.id}`);
      }
    } catch (err) {
      console.error('[Stereo] Failed to parse response:', line, err);
    }
  }

  /**
   * Set calibration parameters
   */
  async setCalibration(calibration: StereoCalibration): Promise<void> {
    if (!this.isReady()) {
      throw new Error('Stereo service is not ready');
    }

    const id = this.generateRequestId();
    const request = {
      id,
      command: 'set_calibration',
      calibration,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('set_calibration request timed out'));
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
   * Set the current frame and start computing disparity proactively
   */
  async setFrame(request: StereoSetFrameRequest): Promise<StereoSetFrameResponse> {
    if (!this.isEnabled()) {
      return {
        id: '',
        success: false,
        error: 'Stereo service is not enabled',
        disparityReady: false,
      };
    }

    const id = this.generateRequestId();
    const fullRequest = {
      id,
      command: 'set_frame',
      left_image_path: request.leftImagePath,
      right_image_path: request.rightImagePath,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('set_frame request timed out'));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, {
        resolve: (response) => resolve({
          id: response.id,
          success: response.success,
          error: response.error,
          disparityReady: response.disparity_ready || false,
          message: response.message,
        }),
        reject,
        timeout,
      });

      const requestLine = `${JSON.stringify(fullRequest)}\n`;
      this.process!.stdin!.write(requestLine);
    });
  }

  /**
   * Get the current status of the stereo service
   */
  async getStatus(): Promise<StereoStatusResponse> {
    if (!this.isReady()) {
      return {
        id: '',
        success: true,
        enabled: false,
        disparityReady: false,
        hasCalibration: false,
      };
    }

    const id = this.generateRequestId();
    const request = { id, command: 'get_status' };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('get_status request timed out'));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, {
        resolve: (response) => resolve({
          id: response.id,
          success: response.success,
          enabled: response.enabled || false,
          disparityReady: response.disparity_ready || false,
          computing: response.computing,
          currentLeftPath: response.current_left_path,
          currentRightPath: response.current_right_path,
          hasCalibration: response.has_calibration || false,
        }),
        reject,
        timeout,
      });

      const requestLine = `${JSON.stringify(request)}\n`;
      this.process!.stdin!.write(requestLine);
    });
  }

  /**
   * Transfer a line from left image to right image using disparity
   */
  async transferLine(request: StereoTransferLineRequest): Promise<StereoTransferLineResponse> {
    if (!this.isEnabled()) {
      return {
        id: '',
        success: false,
        error: 'Stereo service is not enabled',
      };
    }

    const id = this.generateRequestId();
    const fullRequest = {
      id,
      command: 'transfer_line',
      line: request.line,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('transfer_line request timed out'));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, {
        resolve: (response) => resolve({
          id: response.id,
          success: response.success,
          error: response.error,
          transferredLine: response.transferred_line,
          originalLine: response.original_line,
          depthInfo: response.depth_info ? {
            depthPoint1: response.depth_info.depth_point1,
            depthPoint2: response.depth_info.depth_point2,
            disparityPoint1: response.depth_info.disparity_point1,
            disparityPoint2: response.depth_info.disparity_point2,
          } : undefined,
        }),
        reject,
        timeout,
      });

      const requestLine = `${JSON.stringify(fullRequest)}\n`;
      this.process!.stdin!.write(requestLine);
    });
  }

  /**
   * Transfer multiple points from left image to right image
   */
  async transferPoints(request: StereoTransferPointsRequest): Promise<StereoTransferPointsResponse> {
    if (!this.isEnabled()) {
      return {
        id: '',
        success: false,
        error: 'Stereo service is not enabled',
      };
    }

    const id = this.generateRequestId();
    const fullRequest = {
      id,
      command: 'transfer_points',
      points: request.points,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('transfer_points request timed out'));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, {
        resolve: (response) => resolve({
          id: response.id,
          success: response.success,
          error: response.error,
          transferredPoints: response.transferred_points,
          originalPoints: response.original_points,
          disparityValues: response.disparity_values,
        }),
        reject,
        timeout,
      });

      const requestLine = `${JSON.stringify(fullRequest)}\n`;
      this.process!.stdin!.write(requestLine);
    });
  }

  /**
   * Clean up internal state after process exits
   */
  private cleanup(): void {
    // Reject all pending requests
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Stereo service terminated'));
    });
    this.pendingRequests.clear();

    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }

    this.process = null;
    this.enabled = false;
    this.emit('shutdown');
  }

  /**
   * Gracefully shutdown the stereo service
   */
  async shutdown(): Promise<void> {
    if (!this.process) {
      return undefined;
    }

    console.log('[Stereo] Shutting down stereo service...');

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
          console.log('[Stereo] Force killing stereo service...');
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
let serviceManager: StereoServiceManager | null = null;

/**
 * Get the stereo service manager singleton
 */
export function getStereoServiceManager(): StereoServiceManager {
  if (!serviceManager) {
    serviceManager = new StereoServiceManager();
  }
  return serviceManager;
}

/**
 * Shutdown the stereo service (call on app close)
 */
export async function shutdownStereoService(): Promise<void> {
  if (serviceManager) {
    await serviceManager.shutdown();
    serviceManager = null;
  }
}
