/**
 * Backend-to-renderer messaging without importing the electron main module.
 * The electron entrypoint registers a sender at startup; headless consumers
 * (the divecli tool) never register one, and sends become no-ops.
 */
type RendererSender = (channel: string, payload?: unknown) => void;

let sender: RendererSender | null = null;

export function registerRendererSender(fn: RendererSender | null) {
  sender = fn;
}

export default function sendToRenderer(channel: string, payload?: unknown) {
  if (sender) {
    sender(channel, payload);
  }
}
