import { listVisionModels, resolveOllamaUrl } from './vlm';

describe('resolveOllamaUrl', () => {
  it.each([
    [undefined, 'http://localhost:11434'],
    ['', 'http://localhost:11434'],
    ['0.0.0.0', 'http://localhost:11434'],
    ['0.0.0.0:8080', 'http://localhost:8080'],
    ['gpu-box', 'http://gpu-box:11434'],
    ['https://ollama.example.com', 'https://ollama.example.com'],
    ['http://gpu-box:9000/', 'http://gpu-box:9000'],
  ])('%s -> %s', (host, expected) => {
    expect(resolveOllamaUrl(host)).toBe(expected);
  });
});

function fakeFetch(capabilities: Record<string, string[]>): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const body = (payload: unknown) => ({ ok: true, json: async () => payload });
    if (url.endsWith('/api/tags')) {
      return body({ models: Object.keys(capabilities).map((name) => ({ name })) });
    }
    const { model } = JSON.parse(init?.body as string);
    if (capabilities[model] === undefined) {
      return { ok: false, status: 404, statusText: 'Not Found' };
    }
    return body({ capabilities: capabilities[model] });
  }) as unknown as typeof fetch;
}

describe('listVisionModels', () => {
  it('keeps only vision models, sorted, noting thinking support', async () => {
    const result = await listVisionModels('http://x', fakeFetch({
      'qwen3-vl:8b': ['completion', 'vision', 'thinking'],
      'llama3:8b': ['completion'],
      'gemma4:26b': ['completion', 'vision'],
    }));
    expect(result).toEqual({
      available: true,
      models: [
        { name: 'gemma4:26b', thinking: false, installed: true },
        { name: 'qwen3-vl:8b', thinking: true, installed: true },
      ],
    });
  });

  it('offers the recommended model as not installed', async () => {
    const result = await listVisionModels('http://x', fakeFetch({
      'gemma4:26b': ['completion', 'vision'],
    }));
    expect(result.models).toEqual([
      { name: 'gemma4:26b', thinking: false, installed: true },
      { name: 'qwen3-vl:8b', thinking: false, installed: false },
    ]);
  });

  it('reports an unreachable server', async () => {
    const failing = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const result = await listVisionModels('http://x', failing);
    expect(result.available).toBe(false);
    expect(result.models).toEqual([{ name: 'qwen3-vl:8b', thinking: false, installed: false }]);
    expect(result.error).toContain('ECONNREFUSED');
  });
});
