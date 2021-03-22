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
 * the EventSource api.
 *
 * @param rc Girder RestClient
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function registerNotifications(_rc: any) {
  const rc: AugmentedRestClient = _rc; // TODO remove after types fixed
  const ES = window.EventSource;
  const withCredentials = true;
  const timeoutSeconds = 300;
  const retryMsDefault = 8_000;
  let since = new Date();
  let lastConnectionAttempt = new Date();
  let eventSourceInstance: EventSource | null = null;

  function connected() {
    return !!eventSourceInstance;
  }

  function emitNotification(notification: GirderNotification) {
    const { type, updated } = notification;
    if (updated) {
      since = new Date(Math.max(+since, +new Date(updated)));
    }
    for (let i = type.indexOf('.'); i !== -1; i = type.indexOf('.', i + 1)) {
      rc.$emit(`message:${type.substring(0, i)}`, notification);
    }
    rc.$emit(`message:${type}`, notification);
    rc.$emit('message', notification);
  }

  function onSseMessage(e: MessageEvent) {
    emitNotification(JSON.parse(e.data));
  }

  function disconnect() {
    if (eventSourceInstance) {
      eventSourceInstance.close();
    }
    eventSourceInstance = null;
  }

  function onSseError() {
    const nowSeconds = Math.ceil(Date.now() / 1000);
    const lastSeconds = Math.ceil(+lastConnectionAttempt / 1000);
    let retryMs = retryMsDefault;
    /** If time since last success is at least half the timeout, it's probably just a timeout */
    if ((nowSeconds - lastSeconds) > (timeoutSeconds * 0.5)) {
      retryMs = 0;
    }
    disconnect();
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    window.setTimeout(connect, retryMs);
  }

  function connect() {
    if (connected()) {
      return;
    }
    if (!rc.user) {
      return;
    }
    lastConnectionAttempt = new Date();
    const sinceSeconds = Math.ceil(+since / 1000);
    const url = `${rc.apiRoot}/notification/stream?since=${sinceSeconds}&timeout=${timeoutSeconds}`;
    eventSourceInstance = new ES(url, { withCredentials });
    eventSourceInstance.onmessage = onSseMessage;
    eventSourceInstance.onerror = onSseError;
  }

  rc.$on('login', connect);
  rc.$on('logout', disconnect);

  return { connect, disconnect };
}
