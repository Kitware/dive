/**
 * Discovery of locally served vision-language models (Ollama).
 *
 * Inference runs inside the interactive service (it needs frame decoding and
 * cropping); only the cheap model listing happens here so the viewer can show
 * VLM options without starting the Python process.
 */

import { RECOMMENDED_VLM_MODEL } from 'dive-common/apispec';
import type { VlmModel, VlmModelsResponse } from 'dive-common/apispec';

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const LIST_TIMEOUT_MS = 10000;

/** Resolve the Ollama base URL the same way the Ollama CLI reads OLLAMA_HOST. */
export function resolveOllamaUrl(host: string | undefined = process.env.OLLAMA_HOST): string {
  if (!host || !host.trim()) {
    return DEFAULT_OLLAMA_URL;
  }
  const hasScheme = /^https?:\/\//i.test(host.trim());
  const parsed = new URL(hasScheme ? host.trim() : `http://${host.trim()}`);
  if (!hasScheme && !parsed.port) {
    parsed.port = '11434';
  }
  // A server bound to all interfaces is reached through loopback.
  if (parsed.hostname === '0.0.0.0') {
    parsed.hostname = 'localhost';
  }
  return parsed.toString().replace(/\/+$/, '');
}

async function postJson<T>(url: string, body: unknown, fetchFn: typeof fetch): Promise<T> {
  const response = await fetchFn(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function listVisionModels(
  baseUrl: string = resolveOllamaUrl(),
  fetchFn: typeof fetch = fetch,
): Promise<VlmModelsResponse> {
  let names: string[];
  try {
    const tags = await postJson<{ models?: { name: string }[] }>(`${baseUrl}/api/tags`, undefined, fetchFn);
    names = (tags.models || []).map((m) => m.name);
  } catch (err) {
    return {
      available: false,
      models: [{ name: RECOMMENDED_VLM_MODEL, thinking: false, installed: false }],
      error: `Could not reach Ollama at ${baseUrl} (${(err as Error).message}).`,
    };
  }
  const shown = await Promise.all(names.map(async (name): Promise<VlmModel | null> => {
    try {
      const info = await postJson<{ capabilities?: string[] }>(`${baseUrl}/api/show`, { model: name }, fetchFn);
      const capabilities = info.capabilities || [];
      if (!capabilities.includes('vision')) {
        return null;
      }
      return { name, thinking: capabilities.includes('thinking'), installed: true };
    } catch {
      return null;
    }
  }));
  const models = shown.filter((m): m is VlmModel => m !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!names.includes(RECOMMENDED_VLM_MODEL)) {
    models.push({ name: RECOMMENDED_VLM_MODEL, thinking: false, installed: false });
  }
  return { available: true, models };
}
