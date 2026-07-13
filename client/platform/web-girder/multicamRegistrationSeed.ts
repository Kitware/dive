/**
 * Parse per-camera transform/registration files attached at web multicam
 * import time into the dataset's saved camera-registration meta fields --
 * the web counterpart of the desktop backend's transform seeding in
 * beginMultiCamImport (multiCamImport.ts): pairs from every file merge in
 * (last file wins a duplicate pair key), producer stamps merge by
 * agreement, and pairs naming cameras the dataset doesn't have produce a
 * warning rather than a failure (pair bodies name their own cameras, so
 * such pairs import fine but never resolve until camera names match).
 */
import CameraRegistrationStore, { RegistrationSource } from 'vue-media-annotator/alignedView/CameraRegistrationStore';
import {
  CameraRegistrationValues, mergeRegistrationSources, unknownCameraWarning,
} from 'vue-media-annotator/alignedView/cameraRegistrationFiles';

export interface RegistrationSeedEntry {
  cameraName: string;
  fileName: string;
  file: File | undefined;
}

export interface RegistrationSeedResult {
  /** null when no entry contributed any pairs. */
  values: CameraRegistrationValues | null;
  warnings: string[];
}

export async function parseRegistrationSeed(
  entries: RegistrationSeedEntry[],
  datasetCameraNames: string[],
): Promise<RegistrationSeedResult> {
  const homographies: CameraRegistrationValues['homographies'] = {};
  const correspondences: CameraRegistrationValues['correspondences'] = {};
  const transformTypes: CameraRegistrationValues['transformTypes'] = {};
  const stamps: { file: string; source: RegistrationSource | null }[] = [];
  const warnings: string[] = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const { cameraName, fileName, file } of entries) {
    if (!file) {
      throw new Error(
        `Camera "${cameraName}": transform file "${fileName}" is no longer available; please re-select it.`,
      );
    }
    // A throwaway store instance provides the shared parser/validator.
    const store = new CameraRegistrationStore();
    let loaded;
    try {
      // eslint-disable-next-line no-await-in-loop -- files parsed in camera order
      loaded = store.loadRegistrationText(await file.text());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Camera "${cameraName}": invalid transform file: ${message}`);
    }
    const warning = unknownCameraWarning(file.name, loaded.cameras, datasetCameraNames);
    if (warning) {
      warnings.push(warning);
    }
    Object.assign(homographies, store.homographies.value);
    Object.assign(correspondences, store.correspondences.value);
    Object.assign(transformTypes, store.transformTypes.value);
    stamps.push({ file: file.name, source: store.source.value });
  }
  const seeded = Object.keys(homographies).length || Object.keys(correspondences).length;
  return {
    values: seeded ? {
      homographies,
      correspondences,
      transformTypes,
      source: mergeRegistrationSources(stamps),
    } : null,
    warnings,
  };
}
