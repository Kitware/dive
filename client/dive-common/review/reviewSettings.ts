/**
 * Review behaviour settings shared by every chip grid and remembered per browser.
 */
import { reactive, watch } from 'vue';
import {
  DEFAULT_REVIEW_SETTINGS, REVIEW_PLAYBACK_FPS_LIMITS, ReviewSettings,
} from './types';

const SETTINGS_STORAGE_KEY = 'dive.review.settings';

export function loadReviewSettings(): ReviewSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return { ...DEFAULT_REVIEW_SETTINGS, ...parsed };
      }
    }
  } catch {
    // Storage may be unavailable; defaults are fine.
  }
  return { ...DEFAULT_REVIEW_SETTINGS };
}

export function storeReviewSettings(settings: ReviewSettings) {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures.
  }
}

export function normalizeReviewSettings(settings: ReviewSettings): ReviewSettings {
  const [minFps, maxFps] = REVIEW_PLAYBACK_FPS_LIMITS.fps;
  const rawFps = Number(settings.playbackFps);
  const playbackFps = Number.isFinite(rawFps)
    ? Math.min(maxFps, Math.max(minFps, Math.round(rawFps)))
    : DEFAULT_REVIEW_SETTINGS.playbackFps;
  return {
    activateOnHover: settings.activateOnHover !== false,
    playbackFps,
  };
}

/** A reactive settings object seeded from storage and written back on change. */
export function usePersistentReviewSettings(): ReviewSettings {
  const settings = reactive<ReviewSettings>(normalizeReviewSettings(loadReviewSettings()));
  watch(settings, () => storeReviewSettings({ ...settings }), { deep: true });
  return settings;
}
