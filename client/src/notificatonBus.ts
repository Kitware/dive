import { GirderModel, RestClient } from '@girder/components/src';

// TODO remove after GWC types are fixed
interface AugmentedRestClient extends RestClient {
  user: GirderModel;
}

export interface GirderNotification {
  _id: string;
  type: string;
  updated: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/**
 * Based on Girder Web Components NotificationBus, but simpler.
 * Register notifications directly on the girderRest instance using
 * the WebSocket api.
 *
 * @param rc Girder RestClient
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function registerNotifications(_rc: any) {
  const rc: AugmentedRestClient = _rc; // TODO remove after types fixed
  const retryMsDefault = 8_000;
  let webSocketInstance: WebSocket | null = null;

  function connected() {
    return !!webSocketInstance && webSocketInstance.readyState === WebSocket.OPEN;
  }

  function emitNotification(notification: GirderNotification) {
    const { type } = notification;
    for (let i = type.indexOf('.'); i !== -1; i = type.indexOf('.', i + 1)) {
      rc.$emit(`message:${type.substring(0, i)}`, notification);
    }
    rc.$emit(`message:${type}`, notification);
    rc.$emit('message', notification);
  }

  function onWebSocketMessage(e: MessageEvent) {
    emitNotification(JSON.parse(e.data));
  }

  function disconnect() {
    if (webSocketInstance) {
      webSocketInstance.close();
    }
    webSocketInstance = null;
  }

  function onWebSocketError() {
    disconnect();
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    window.setTimeout(connect, retryMsDefault);
  }

  function onWebSocketClose() {
    webSocketInstance = null;
    // Attempt to reconnect after a delay
    if (rc.user) {
      window.setTimeout(connect, retryMsDefault);
    }
  }

  function connect() {
    if (connected()) {
      return;
    }
    if (!rc.user) {
      return;
    }
    // Get the token from RestClient
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { token } = rc as any;
    if (!token) {
      return;
    }
    // Construct WebSocket URL from current location
    const { protocol, host } = window.location;
    const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${wsProtocol}//${host}/notifications/me?token=${token}`;
    webSocketInstance = new WebSocket(url);
    webSocketInstance.onmessage = onWebSocketMessage;
    webSocketInstance.onerror = onWebSocketError;
    webSocketInstance.onclose = onWebSocketClose;
  }

  rc.$on('login', connect);
  rc.$on('logout', disconnect);

  return { connect, disconnect };
}
