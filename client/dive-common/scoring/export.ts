import type { ScoringResultFile } from './types';
import {
  formatMetric, METRIC_GROUPS, parseScoringMetrics, ScoringMetrics,
} from './metrics';

const PER_CLASS_COLUMNS = [
  'total_gt', 'total_computed', 'true_positives', 'false_positives', 'false_negatives',
  'precision', 'recall', 'f1_score', 'average_precision', 'ap_any', 'ap50', 'ap75', 'ap50_95',
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'number' ? String(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function row(...cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

function timestampSlug(created: string): string {
  const d = new Date(created);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (Number.isNaN(d.getTime())) return 'run';
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function exportFilename(result: ScoringResultFile, extension: string): string {
  return `scoring_${timestampSlug(result.created)}.${extension}`;
}

/** The run exactly as stored: parameters, sequences, tool metrics and matches. */
export function resultToJson(result: ScoringResultFile): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Spreadsheet-friendly blocks: the run, every summary metric with its label,
 * the per-class table, the confusion matrix and the sweep's best thresholds.
 * Blocks are separated by a blank line and introduced by a `#` heading row.
 */
export function resultToCsv(result: ScoringResultFile, parsed?: ScoringMetrics): string {
  const metrics = parsed || parseScoringMetrics(result.metrics);
  const lines: string[] = [];

  lines.push('# Run');
  lines.push(row('title', result.title));
  lines.push(row('created', result.created));
  result.pairs.forEach((pair, i) => {
    lines.push(row(`sequence ${i + 1} computed`, pair.computed.label || pair.computed.datasetId));
    lines.push(row(`sequence ${i + 1} truth`, pair.truth.label || pair.truth.datasetId));
  });
  Object.entries(result.params).forEach(([key, value]) => {
    if (key === 'labelSynonyms' && !value) return;
    lines.push(row(`param ${key}`, value));
  });

  lines.push('');
  lines.push('# Summary');
  lines.push(row('metric', 'label', 'value'));
  const seen = new Set<string>();
  METRIC_GROUPS.forEach((group) => {
    group.metrics.forEach((m) => {
      if (m.key in metrics.values) {
        seen.add(m.key);
        lines.push(row(m.key, m.label, metrics.values[m.key]));
      }
    });
  });
  Object.entries(metrics.values).forEach(([key, value]) => {
    if (!seen.has(key)) lines.push(row(key, key, value));
  });

  const classNames = Object.keys(metrics.perClass).sort();
  if (classNames.length) {
    lines.push('');
    lines.push('# Per class');
    lines.push(row('class', ...PER_CLASS_COLUMNS));
    classNames.forEach((name) => {
      lines.push(row(name, ...PER_CLASS_COLUMNS.map((key) => metrics.perClass[name][key])));
    });
  }

  const cm = metrics.confusionMatrix;
  if (cm) {
    lines.push('');
    lines.push('# Confusion matrix (rows: truth, columns: computed)');
    lines.push(row('truth \\ computed', ...cm.classNames));
    cm.classNames.forEach((name, r) => {
      lines.push(row(name, ...(cm.matrix[r] || [])));
    });
  }

  if (metrics.sweep) {
    lines.push('');
    lines.push('# Sweep best thresholds');
    lines.push(row('curve', 'idf1', 'idf1_threshold', 'mota', 'mota_threshold'));
    Object.entries(metrics.sweep.curves).forEach(([name, curve]) => {
      lines.push(row(name, curve.best.idf1, curve.best.idf1Thresh, curve.best.mota, curve.best.motaThresh));
    });
  }

  return `${lines.join('\n')}\n`;
}

/** Browser download of a text file, the fallback when the platform offers no save dialog. */
export function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export { formatMetric };
