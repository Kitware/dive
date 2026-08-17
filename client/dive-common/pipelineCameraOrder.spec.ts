import { describe, expect, it } from 'vitest';
import {
  camerasMatchingSlot, inferCameraRole, inferCameraRoles, parseCameraOrderHeader,
  pipelineCameraSlots, prefillPipelineCameraOrder, resolvePipelineCameraOrder,
} from './pipelineCameraOrder';
import { pipelineCameraNames } from './multicamDisplay';

describe('pipelineCameraOrder', () => {
  it('parses the header value into slot tokens', () => {
    expect(parseCameraOrderHeader(' EO, UV, IR ')).toStrictEqual(['EO', 'UV', 'IR']);
    expect(parseCameraOrderHeader('left right')).toStrictEqual(['left', 'right']);
    expect(parseCameraOrderHeader('')).toStrictEqual([]);
  });

  it('matches slots by exact name, name segment, or role alias', () => {
    const cameras = ['rgb', 'CENT_IR', 'uv_cam'];
    expect(camerasMatchingSlot('EO', cameras)).toStrictEqual(['rgb']);
    expect(camerasMatchingSlot('IR', cameras)).toStrictEqual(['CENT_IR']);
    expect(camerasMatchingSlot('ultraviolet', cameras)).toStrictEqual(['uv_cam']);
    expect(camerasMatchingSlot('rgb', cameras)).toStrictEqual(['rgb']);
    // Exact name wins over role matching elsewhere.
    expect(camerasMatchingSlot('ir', ['ir', 'thermal'])).toStrictEqual(['ir']);
    // Literal segments for non-role tokens.
    expect(camerasMatchingSlot('left', ['left_cam', 'right_cam'])).toStrictEqual(['left_cam']);
  });

  it('resolves declared slots to a full, unique camera order', () => {
    expect(resolvePipelineCameraOrder(['EO', 'UV', 'IR'], ['rgb', 'ir', 'uv']))
      .toStrictEqual({ order: ['rgb', 'uv', 'ir'] });
    expect(resolvePipelineCameraOrder(['EO', 'IR'], ['CENT_IR', 'CENT_EO']))
      .toStrictEqual({ order: ['CENT_EO', 'CENT_IR'] });
  });

  it('reports count mismatch, unmatched and ambiguous slots', () => {
    expect(resolvePipelineCameraOrder(['EO', 'IR'], ['rgb', 'ir', 'uv']).error)
      .toMatch(/expects 2 cameras but the dataset has 3/);
    expect(resolvePipelineCameraOrder(['EO', 'UV', 'IR'], ['rgb', 'ir', 'cam3']).error)
      .toMatch(/"UV" \(input2\): no dataset camera matches/);
    expect(resolvePipelineCameraOrder(['EO', 'IR'], ['rgb', 'color']).error)
      .toMatch(/"EO" \(input1\): several dataset cameras match \(rgb, color\)/);
  });

  it('infers roles from camera names, then image names, only when unanimous', () => {
    expect(inferCameraRole('rgb')).toBe('eo');
    expect(inferCameraRole('CENT_IR')).toBe('ir');
    expect(inferCameraRole('uv_cam')).toBe('uv');
    expect(inferCameraRole('cam1', ['flight_0001_rgb.jpg', 'flight_0002_rgb.jpg'])).toBe('eo');
    expect(inferCameraRole('cam1', ['a_rgb.jpg', 'b_ir.tif'])).toBeNull();
    expect(inferCameraRole('eo_ir')).toBeNull();
    expect(inferCameraRole('center', ['0001.png'])).toBeNull();
    expect(inferCameraRoles({ rgb: [], center: ['x_ir.tif'], other: ['a.png'] }))
      .toStrictEqual({ rgb: 'eo', center: 'ir' });
  });

  it('assigned roles beat name matching, and prefill leaves ambiguity open', () => {
    // "thermal" is named like IR but the user marked it optical.
    expect(resolvePipelineCameraOrder(['EO', 'IR'], ['thermal', 'other'], { thermal: 'eo', other: 'ir' }))
      .toStrictEqual({ order: ['thermal', 'other'] });
    expect(prefillPipelineCameraOrder(['EO', 'UV', 'IR'], ['rgb', 'ir', 'uv']))
      .toStrictEqual(['rgb', 'uv', 'ir']);
    // Two EO-ish names, no roles: the EO slot stays open, IR still fills.
    expect(prefillPipelineCameraOrder(['EO', 'IR'], ['rgb', 'color', 'ir']))
      .toStrictEqual([null, 'ir']);
    // Bare positional slots: nothing to match on, all open.
    expect(prefillPipelineCameraOrder(['input1', 'input2'], ['rgb', 'ir']))
      .toStrictEqual([null, null]);
    expect(pipelineCameraSlots(['EO', 'IR'], 2)).toStrictEqual(['EO', 'IR']);
    expect(pipelineCameraSlots(undefined, 3)).toStrictEqual(['input1', 'input2', 'input3']);
  });

  it('pipelineCameraNames uses the declared order or falls back to reference-first', () => {
    const media = {
      cameras: { ir: {}, rgb: {}, uv: {} },
      cameraOrder: ['rgb', 'ir', 'uv'],
      defaultDisplay: 'rgb',
    };
    expect(pipelineCameraNames(media, ['EO', 'UV', 'IR'])).toStrictEqual(['rgb', 'uv', 'ir']);
    expect(pipelineCameraNames(media)).toStrictEqual(['rgb', 'ir', 'uv']);
    expect(() => pipelineCameraNames(media, ['EO', 'IR'])).toThrow(/expects 2 cameras/);
  });
});
