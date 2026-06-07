type Handler = (...args: unknown[]) => void;

/**
 * Minimal event bus replacing `new Vue()` for cross-module events.
 * API mirrors Vue 2's instance event methods for easier Vue 3 migration.
 */
export default class EventBus {
  private handlers = new Map<string, Set<Handler>>();

  $on(event: string, handler: Handler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  $off(event: string, handler: Handler): void {
    this.handlers.get(event)?.delete(handler);
  }

  $emit(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.forEach((handler) => {
      handler(...args);
    });
  }
}

export function createEventBus(): EventBus {
  return new EventBus();
}
