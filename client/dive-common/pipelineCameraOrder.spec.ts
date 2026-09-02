import { describe, expect, it } from 'vitest';
import {
  camerasForSlot, defaultDialogCameraOrder, describeSlotRoleMismatch, fittedRegistrationPairs,
  inferCameraRole, inferCameraRoles, missingRegistrations, parseCameraOrderHeader,
  pipelineCameraSlots, prefillPipelineCameraOrder, proposedPipelineCameraOrder, slotRoleMismatches,
} from './pipelineCameraOrder';

describe('pipelineCameraOrder', () => {
  it('parses the header value into slot tokens', () => {
    expect(parseCameraOrderHeader(' EO, UV, IR ')).toStrictEqual(['EO', 'UV', 'IR']);
    expect(parseCameraOrderHeader('left right')).toStrictEqual(['left', 'right']);
    expect(parseCameraOrderHeader('')).toStrictEqual([]);
  });

  it('matches slots by exact name, name segment, or role alias', () => {
    const cameras = ['rgb', 'CENT_IR', 'uv_cam'];
    expect(camerasForSlot('EO', cameras)).toStrictEqual(['rgb']);
    expect(camerasForSlot('IR', cameras)).toStrictEqual(['CENT_IR']);
    expect(camerasForSlot('ultraviolet', cameras)).toStrictEqual(['uv_cam']);
    expect(camerasForSlot('rgb', cameras)).toStrictEqual(['rgb']);
    // Exact name wins over role matching elsewhere.
    expect(camerasForSlot('ir', ['ir', 'thermal'])).toStrictEqual(['ir']);
    // Literal segments for non-role tokens.
    expect(camerasForSlot('left', ['left_cam', 'right_cam'])).toStrictEqual(['left_cam']);
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

  it('maps display order 1:1 when used directly', () => {
    expect(proposedPipelineCameraOrder(['eo', 'uv', 'ir'])).toStrictEqual(['eo', 'uv', 'ir']);
  });

  it('prefers role/name matches and falls back to display order for empty slots', () => {
    expect(defaultDialogCameraOrder(['EO', 'UV', 'IR'], ['rgb', 'ir', 'uv']))
      .toStrictEqual(['rgb', 'uv', 'ir']);
    expect(defaultDialogCameraOrder(['input1', 'input2'], ['rgb', 'ir']))
      .toStrictEqual(['rgb', 'ir']);
    expect(defaultDialogCameraOrder(['EO', 'IR'], ['rgb', 'color', 'ir']))
      .toStrictEqual(['rgb', 'ir']);
  });

  it('assigned roles beat name matching, and prefill leaves ambiguity open', () => {
    // "thermal" is named like IR but the user marked it optical.
    expect(prefillPipelineCameraOrder(['EO', 'IR'], ['thermal', 'other'], { thermal: 'eo', other: 'ir' }))
      .toStrictEqual(['thermal', 'other']);
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

  it('lists only homography pairs with a fitted matrix', () => {
    const fitted = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    expect(fittedRegistrationPairs({
      'rgb::ir': { AtoB: fitted, BtoA: fitted },
      'uv::rgb': { AtoB: [], BtoA: [] },
      'eo::ir': {},
    })).toStrictEqual(['rgb::ir']);
    expect(fittedRegistrationPairs(undefined)).toStrictEqual([]);
  });

  it('reports slot labels that disagree with saved camera roles', () => {
    const slots = ['EO', 'UV', 'IR'];
    const order = ['cam_a', 'cam_b', 'cam_c'];
    const roles = { cam_a: 'ir' as const, cam_b: 'eo' as const, cam_c: 'uv' as const };
    expect(slotRoleMismatches(slots, order, roles)).toStrictEqual([
      {
        input: 1, slotLabel: 'EO', slotRole: 'eo', camera: 'cam_a', cameraRole: 'ir',
      },
      {
        input: 2, slotLabel: 'UV', slotRole: 'uv', camera: 'cam_b', cameraRole: 'eo',
      },
      {
        input: 3, slotLabel: 'IR', slotRole: 'ir', camera: 'cam_c', cameraRole: 'uv',
      },
    ]);
    expect(describeSlotRoleMismatch({
      input: 1, slotLabel: 'EO', slotRole: 'eo', camera: 'cam_a', cameraRole: 'ir',
    })).toBe('Camera 1 (Optical (EO)): "cam_a" is saved as Thermal (IR).');
    expect(slotRoleMismatches(slots, ['eo', 'uv', 'ir'], { eo: 'eo', uv: 'uv', ir: 'ir' }))
      .toStrictEqual([]);
  });

  it('reports warped cameras with no fitted registration onto camera 1', () => {
    const order = ['rgb', 'uv', 'ir'];
    // Stored in the reverse orientation still counts.
    expect(missingRegistrations(order, [2, 3], ['rgb::ir']))
      .toStrictEqual([{ input: 2, camera: 'uv', target: 'rgb' }]);
    expect(missingRegistrations(order, [2, 3], ['rgb::ir', 'uv::rgb'])).toStrictEqual([]);
    expect(missingRegistrations(order, undefined, [])).toStrictEqual([]);
    expect(missingRegistrations([null, 'uv'], [2], [])).toStrictEqual([]);
    // An unfilled slot is reported by the assignment problems, not here.
    expect(missingRegistrations(['rgb', null], [2], [])).toStrictEqual([]);
  });
});
