type CloseGuard = () => Promise<boolean>;

let closeGuard: CloseGuard | null = null;

export function setCloseGuard(guard: CloseGuard | null) {
  closeGuard = guard;
}

export async function runCloseGuard(): Promise<boolean> {
  if (closeGuard) {
    return closeGuard();
  }
  return true;
}
