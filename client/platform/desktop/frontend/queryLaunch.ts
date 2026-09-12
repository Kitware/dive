/** One-shot handoff after the viewer's normal unsaved-change navigation guard. */
export interface QueryLaunch {
  imagePath: string;
  box?: [number, number, number, number];
  modelPath?: string;
  streamName: string | null;
}
let serial = 0;
const pending = new Map<string, QueryLaunch>();
export function holdQueryLaunch(launch: QueryLaunch): string {
  serial += 1;
  const key = String(serial);
  pending.set(key, launch);
  // Abandoned navigation must not retain image paths indefinitely.
  while (pending.size > 10) pending.delete(pending.keys().next().value!);
  return key;
}
export function takeQueryLaunch(key: string): QueryLaunch | undefined {
  const launch = pending.get(key);
  pending.delete(key);
  return launch;
}
