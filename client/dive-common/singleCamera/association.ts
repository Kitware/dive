/** Geometry-only pairing needs timestamps, but does not need to decode camera media.
 * A one-pixel image repeated through the last annotated frame supplies that clock.
 * frame_list is one-based; downsample supplies DIVE's zero-based frame numbers.
 */
export const stereoAssociationPipeline = `config _scheduler
  :type thread_per_process

process clock
  :: frame_list_input
  :image_list_file frames.txt
  :image_reader:type ocv

process timestamps
  :: downsample
  :renumber_frames true

connect from clock.timestamp
        to timestamps.timestamp

process pairing
  :: compute_measurements
  :matching_methods input_pairs_only
  :detection_pairing_method calibration
  :detection_pairing_threshold 10
  :calibration_file calibration.json
  :accumulate_track_pairings true
  :pairing_resolution_method most_likely
  :detection_split_threshold 1
  :output_unmatched true
  :average_stereo_classes false

connect from timestamps.timestamp
        to pairing.timestamp
${[1, 2].map((side) => `
process reader${side}
  :: read_object_track
  :file_name input${side}.csv
  :reader:type viame_csv

connect from clock.image_file_name
        to reader${side}.image_file_name
connect from reader${side}.object_track_set
        to pairing.object_track_set${side}

process writer${side}
  :: write_object_track
  :file_name associated${side}.csv
  :writer:type viame_csv

connect from pairing.object_track_set${side}
        to writer${side}.object_track_set
`).join('')}`;

export function lastCsvFrame(csv: string): number {
  let maximum = -1;
  csv.split(/\r?\n/).forEach((row) => {
    if (/^\s*\d+,/.test(row)) {
      // A quoted image identifier may itself contain commas.
      const fields = row.match(/^\s*\d+,(?:"(?:[^"]|"")*"|[^,]*),([^,]*),/);
      const frame = fields ? Number(fields[1]) : NaN;
      if (!Number.isSafeInteger(frame) || frame < 0) throw new Error('Invalid detection frame number.');
      maximum = Math.max(maximum, frame);
    }
  });
  return maximum;
}
