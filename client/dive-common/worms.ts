import type { CategoryImport } from './categoryImport';
import { normalizeTypeHierarchy } from './typeHierarchy';

export interface TaxonomySource {
  aphiaId: number;
  scientificName: string;
  rank: string;
}
/** Source records keyed by AphiaID; retained as import provenance even if a type is later renamed. */
export type TaxonomySources = Record<string, TaxonomySource>;

export interface WormsRecord {
  AphiaID: number;
  scientificname: string;
  rank: string;
  status: string;
  authority?: string;
  valid_AphiaID: number | null;
  valid_name: string | null;
}

/** A WoRMS synonym (or unaccepted name) resolved to its accepted scientific name. */
export interface SynonymRemap {
  original: string;
  accepted: string;
}

export interface SynonymRemapGroup {
  accepted: string;
  originals: string[];
}

/** Group remaps by accepted name for a compact import preview. */
export function groupSynonymRemaps(remaps: SynonymRemap[]): SynonymRemapGroup[] {
  const groups = new Map<string, string[]>();
  remaps.forEach(({ original, accepted }) => {
    const list = groups.get(accepted) ?? [];
    if (!list.includes(original)) list.push(original);
    groups.set(accepted, list);
  });
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(([accepted, originals]) => ({
      accepted,
      originals: [...originals].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    }));
}

export function synonymRemapSummary(remaps: SynonymRemap[]): string {
  const groups = groupSynonymRemaps(remaps);
  const synonymCount = groups.reduce((n, group) => n + group.originals.length, 0);
  const acceptedCount = groups.length;
  const synonymLabel = synonymCount === 1 ? 'synonym' : 'synonyms';
  const acceptedLabel = acceptedCount === 1 ? 'accepted name' : 'accepted names';
  return `${synonymCount} ${synonymLabel} will be imported as ${acceptedCount} ${acceptedLabel}.`;
}

interface Classification {
  AphiaID: number;
  scientificname: string;
  rank: string;
  child: Classification | null;
}

export const WORMS_PAGE_SIZE = 50;
export const wormsLink = (id: number) => `https://www.marinespecies.org/aphia.php?p=taxdetails&id=${id}`;

function validTaxon(value: unknown): value is Classification {
  const taxon = value as Classification | null;
  return !!taxon && Number.isSafeInteger(taxon.AphiaID) && taxon.AphiaID > 0
    && typeof taxon.scientificname === 'string' && !!taxon.scientificname.trim()
    && typeof taxon.rank === 'string';
}

function record(value: unknown): WormsRecord {
  if (!validTaxon(value) || typeof (value as unknown as WormsRecord).status !== 'string') {
    throw new Error('WoRMS returned an invalid taxon record.');
  }
  return value as unknown as WormsRecord;
}

/** One client per open dialog. Requests are cancellable and successful lookups are bounded/cached. */
export class WormsClient {
  private cache = new Map<string, unknown>();

  constructor(private request: typeof fetch = (...args) => fetch(...args)) {
    // Native browser fetch requires Window (or undefined) as its receiver.
    // Calling a stored reference as this.request binds it to WormsClient instead.
    // The wrapper preserves the browser receiver while allowing test transports.
  }

  private async get(path: string, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new Error('WoRMS request cancelled.');
    if (this.cache.has(path)) return this.cache.get(path);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 20000);
    try {
      const response = await this.request(`https://www.marinespecies.org/rest/${path}`, {
        signal: controller.signal, credentials: 'omit', headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(response.status === 429
          ? 'WoRMS is receiving too many requests. Wait a moment and try again.'
          : `WoRMS request failed (${response.status}). Please try again.`);
      }
      const value: unknown = response.status === 204 ? null : await response.json();
      if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(path, value);
      return value;
    } catch (error) {
      if (signal.aborted) throw new Error('WoRMS request cancelled.');
      if (controller.signal.aborted) throw new Error('WoRMS request timed out. Please try again.');
      if (error instanceof TypeError) throw new Error('Cannot reach WoRMS. Check your internet connection and try again.');
      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    }
  }

  async search(name: string, offset: number, signal: AbortSignal): Promise<WormsRecord[]> {
    if (name.trim().length < 2) throw new Error('Enter at least two characters.');
    return this.page(`AphiaRecordsByName/${encodeURIComponent(name.trim())}?like=true&marine_only=true&offset=${offset}`, signal);
  }

  async children(id: number, offset: number, signal: AbortSignal): Promise<WormsRecord[]> {
    return this.page(`AphiaChildrenByAphiaID/${id}?marine_only=true&offset=${offset}`, signal);
  }

  private async page(path: string, signal: AbortSignal): Promise<WormsRecord[]> {
    const result = await this.get(path, signal);
    if (result === null) return [];
    if (!Array.isArray(result)) throw new Error('WoRMS returned an invalid result list.');
    return result.map(record);
  }

  async prepare(
    selected: WormsRecord[],
    includeParents: boolean,
    signal: AbortSignal,
    progress: (completed: number) => void = () => {},
  ): Promise<CategoryImport> {
    const types = new Set<string>();
    const sources: TaxonomySources = {};
    const names = new Map<string, number>();
    const edges = new Map<string, string>();
    const warnings = new Set<string>();
    const remaps = new Map<string, SynonymRemap>();
    const acceptedByOriginal = new Map<string, Set<string>>();
    const addTaxon = (taxon: Classification | WormsRecord) => {
      const existing = names.get(taxon.scientificname);
      if (existing !== undefined && existing !== taxon.AphiaID) {
        throw new Error(`Different WoRMS taxa share the name "${taxon.scientificname}". Import them separately with distinct type names.`);
      }
      names.set(taxon.scientificname, taxon.AphiaID);
      sources[String(taxon.AphiaID)] = {
        aphiaId: taxon.AphiaID, scientificName: taxon.scientificname, rank: taxon.rank,
      };
    };
    // Sequential requests avoid a burst against the public service; cached ancestors/records are reused.
    for (let i = 0; i < selected.length; i += 1) {
      const original = selected[i];
      let accepted = original;
      if (original.status !== 'accepted') {
        if (!Number.isSafeInteger(original.valid_AphiaID) || !original.valid_AphiaID) {
          throw new Error(`"${original.scientificname}" has no accepted WoRMS name. Choose another taxon.`);
        }
        // eslint-disable-next-line no-await-in-loop
        accepted = record(await this.get(`AphiaRecordByAphiaID/${original.valid_AphiaID}`, signal));
        if (accepted.status !== 'accepted') throw new Error(`WoRMS could not resolve "${original.scientificname}" to an accepted name.`);
        remaps.set(`${original.scientificname}\0${accepted.scientificname}`, {
          original: original.scientificname,
          accepted: accepted.scientificname,
        });
        const targets = acceptedByOriginal.get(original.scientificname) ?? new Set();
        targets.add(accepted.scientificname);
        acceptedByOriginal.set(original.scientificname, targets);
      }
      addTaxon(accepted);
      if (!types.has(accepted.scientificname) && includeParents) {
        // eslint-disable-next-line no-await-in-loop
        let node = await this.get(`AphiaClassificationByAphiaID/${accepted.AphiaID}`, signal);
        let parent: string | undefined;
        const visited = new Set<number>();
        let lastId: number | undefined;
        while (node !== null && node !== undefined) {
          if (!validTaxon(node) || visited.has(node.AphiaID)) throw new Error('WoRMS returned an invalid classification.');
          visited.add(node.AphiaID);
          addTaxon(node);
          if (parent !== undefined) {
            if (edges.has(node.scientificname) && edges.get(node.scientificname) !== parent) {
              throw new Error(`WoRMS returned conflicting parents for "${node.scientificname}".`);
            }
            edges.set(node.scientificname, parent);
          }
          parent = node.scientificname;
          lastId = node.AphiaID;
          node = node.child;
        }
        if (lastId !== accepted.AphiaID) throw new Error(`WoRMS returned an incomplete classification for "${accepted.scientificname}".`);
      }
      types.add(accepted.scientificname);
      progress(i + 1);
    }
    acceptedByOriginal.forEach((targets, originalName) => {
      if (targets.size > 1) {
        const listed = [...targets].sort((a, b) => a.localeCompare(b)).map((name) => `"${name}"`).join(', ');
        warnings.add(`"${originalName}" resolves to multiple accepted names: ${listed}.`);
      }
    });
    const synonymRemaps = [...remaps.values()];
    return {
      types: [...types],
      typeHierarchy: normalizeTypeHierarchy(Object.fromEntries(edges)),
      taxonomySources: sources,
      synonymRemaps: synonymRemaps.length ? synonymRemaps : undefined,
      warnings: [...warnings],
    };
  }
}
