import mitt, { type Emitter, type EventType } from 'mitt';

export type EventBus = Emitter<Record<EventType, unknown>> & {
  $on: Emitter<Record<EventType, unknown>>['on'];
  $off: Emitter<Record<EventType, unknown>>['off'];
  $emit: Emitter<Record<EventType, unknown>>['emit'];
};

export function createEventBus(): EventBus {
  const emitter = mitt();
  return Object.assign(emitter, {
    $on: emitter.on.bind(emitter),
    $off: emitter.off.bind(emitter),
    $emit: emitter.emit.bind(emitter),
  });
}

export default createEventBus;
