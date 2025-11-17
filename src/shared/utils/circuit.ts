/**
 * Advanced Circuit Breaker
 * - Sliding window for failures
 * - Single-call HALF_OPEN state (safe probe)
 * - Exponential backoff
 * - Callbacks for all state changes
 * - User-friendly messages
 */

export interface CircuitBreakerOptions {
  failureThreshold: number;        // Max failures before opening
  windowDuration: number;          // Sliding window duration (ms)
  resetTimeout: number;            // Initial open duration (ms)
  maxResetTimeout?: number;        // Maximum backoff timeout
  backoffFactor?: number;          // Multiplier for exponential backoff
  userFriendlyMessage?: string;    // Error message for frontend users
  allowRetries?: boolean;          // Enable retry attempts in CLOSED state
  retryAttempts?: number;          // How many retries
  retryDelay?: number;             // Delay between retries (ms)
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerCallbacks {
  onOpen?: () => void;
  onClose?: () => void;
  onHalfOpen?: () => void;
  onSuccess?: () => void;
  onFailure?: (error: any) => void;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureTimestamps: number[] = [];
  private openTimestamp = 0;
  private currentTimeout = 0;
  private halfOpenProbeInProgress = false;

  constructor(
    private options: CircuitBreakerOptions,
    private callbacks: CircuitBreakerCallbacks = {}
  ) {
    this.currentTimeout = options.resetTimeout;
  }

  /**
   * Main executor function
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.cleanupWindow();

    if (this.state === 'OPEN') {
      return this.handleOpenState();
    }

    if (this.state === 'HALF_OPEN') {
      return this.handleHalfOpenState(operation);
    }

    return this.handleClosedState(operation);
  }

  /**
   * Handle CLOSED state: normal operations
   */
  private async handleClosedState<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await this.performWithRetries(operation);
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  /**
   * Handle OPEN state: block operations
   */
  private async handleOpenState<T>(): Promise<T> {
    const now = Date.now();
    if (now - this.openTimestamp >= this.currentTimeout) {
      this.transitionToHalfOpen();
    } else {
      const message =
        this.options.userFriendlyMessage ||
        'Service is temporarily unavailable. Please try again later.';
      throw new Error(message);
    }

    // Once Half-Open is allowed:
    throw new Error('Service is currently recovering. Please retry your request.');
  }

  /**
   * HALF_OPEN state: allow only 1 probe call
   */
  private async handleHalfOpenState<T>(operation: () => Promise<T>): Promise<T> {
    if (this.halfOpenProbeInProgress) {
      const msg =
        this.options.userFriendlyMessage ||
        'Service is currently recovering. Please retry in a moment.';
      throw new Error(msg);
    }

    this.halfOpenProbeInProgress = true;

    try {
      const result = await operation();
      this.transitionToClosed();
      return result;
    } catch (error) {
      this.transitionToOpen();
      throw error;
    } finally {
      this.halfOpenProbeInProgress = false;
    }
  }

  /**
   * Optional retry logic
   */
  private async performWithRetries<T>(operation: () => Promise<T>): Promise<T> {
    const attempts = this.options.allowRetries
      ? this.options.retryAttempts || 1
      : 1;

    let lastError: any;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = await operation();
        this.callbacks.onSuccess?.();
        return result;
      } catch (error) {
        lastError = error;
        this.callbacks.onFailure?.(error);

        if (attempt < attempts && this.options.retryDelay) {
          await new Promise((res) => setTimeout(res, this.options.retryDelay));
        }
      }
    }

    throw lastError;
  }

  /**
   * Record failure for sliding window
   */
  private recordFailure(error: any) {
    const now = Date.now();
    this.failureTimestamps.push(now);

    this.cleanupWindow();

    if (this.failureTimestamps.length >= this.options.failureThreshold) {
      this.transitionToOpen();
    }
  }

  /**
   * Remove timestamps outside sliding window
   */
  private cleanupWindow() {
    const cutoff = Date.now() - this.options.windowDuration;
    this.failureTimestamps = this.failureTimestamps.filter(ts => ts >= cutoff);
  }

  /**
   * State transitions
   */
  private transitionToOpen() {
    if (this.state !== 'OPEN') {
      this.state = 'OPEN';
      this.openTimestamp = Date.now();
      this.callbacks.onOpen?.();

      // Exponential backoff
      this.currentTimeout = Math.min(
        this.currentTimeout * (this.options.backoffFactor || 2),
        this.options.maxResetTimeout || 60000
      );
    }
  }

  private transitionToHalfOpen() {
    if (this.state !== 'HALF_OPEN') {
      this.state = 'HALF_OPEN';
      this.callbacks.onHalfOpen?.();
    }
  }

  private transitionToClosed() {
    this.state = 'CLOSED';
    this.failureTimestamps = [];
    this.currentTimeout = this.options.resetTimeout; // reset backoff
    this.callbacks.onClose?.();
  }

  /**
   * Public metrics getters
   */
  getState() {
    return this.state;
  }

  getFailureCount() {
    return this.failureTimestamps.length;
  }

  getCurrentTimeout() {
    return this.currentTimeout;
  }
}
