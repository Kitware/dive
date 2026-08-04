// @vitest-environment jsdom
/* eslint-disable import/no-extraneous-dependencies */
import { mount } from '@vue/test-utils';
import Vue, { CreateElement, nextTick } from 'vue';

import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

import type { ValidatedUploadRoleMap, ValidationResponse } from 'platform/web-girder/api';
import type { DatasetType } from 'dive-common/apispec';
import { openFromDisk } from 'platform/web-girder/utils';
import { validateUploadGroup } from 'platform/web-girder/api';
import Upload from './Upload.vue';

Vue.config.ignoredElements = [/^v-/];

vi.mock('platform/web-girder/api', () => ({
  createGirderFolder: vi.fn(),
  createMulticamDataset: vi.fn(),
  deleteResources: vi.fn(),
  saveMetadata: vi.fn(),
  uploadCalibrationItem: vi.fn(),
  uploadMetadataFileItem: vi.fn(),
  validateUploadGroup: vi.fn(),
  waitForFolderDatasetReady: vi.fn(),
}));

vi.mock('platform/web-girder/utils', () => ({
  openFromDisk: vi.fn(),
  GirderUploadManager: class {},
}));

vi.mock('vue-router/composables', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('dive-common/vue-utilities/prompt-service', () => ({
  usePrompt: () => ({ prompt: vi.fn() }),
}));

const Stub = {
  render(this: Vue, h: CreateElement) {
    return h('div');
  },
};

/** Renders the row slot the way UploadGirder does, with a spy for the upload action. */
function uploadGirderStub(upload: () => Promise<void>) {
  return {
    name: 'UploadGirder',
    render(this: Vue, h: CreateElement) {
      return h('div', this.$scopedSlots.default?.({ upload }));
    },
  };
}

function file(name: string): File {
  return new File([name], name, { type: 'application/octet-stream' });
}

const emptyRoles: ValidatedUploadRoleMap = {
  media: [], annotations: [], datasetConfig: [], ignored: [],
};

/** A passing validation response; unnamed roles default to empty. */
function validation(overrides: {
  type?: DatasetType;
  roles?: Partial<ValidatedUploadRoleMap>;
  reasons?: Record<string, string>;
} = {}): ValidationResponse {
  const { roles, type = 'video', reasons = {} } = overrides;
  return {
    ok: true, type, message: '', reasons, roles: { ...emptyRoles, ...roles },
  };
}

/** A rejected selection: a blocking message, and no media type at all. */
function rejection(message: string): ValidationResponse {
  return {
    ok: false, message, roles: { ...emptyRoles }, reasons: {},
  };
}

function mountUpload(upload: () => Promise<void> = () => Promise.resolve()) {
  return mount(Upload, {
    propsData: { location: { _id: 'folder-id', _modelType: 'folder' } },
    stubs: {
      ImportButton: Stub,
      ImportMultiCamDialog: Stub,
      ImportMultiCamBatchDialog: Stub,
      UploadGirder: uploadGirderStub(upload),
    },
  });
}

function pick(files: File[]) {
  vi.mocked(openFromDisk).mockResolvedValue({
    canceled: false,
    filePaths: files.map((f) => f.name),
    fileList: files,
  });
}

describe('Upload pending rows', () => {
  beforeEach(() => {
    vi.mocked(openFromDisk).mockReset();
    vi.mocked(validateUploadGroup).mockReset();
  });

  it('derives fan-out from the server media role, not the client slot guess', async () => {
    // camera.npz cannot be classified, so it stays in the media slot; only the server knows
    // it is not media. Counting the slot instead would fan one video out into subfolders.
    pick([file('dive.mp4'), file('camera.npz')]);
    vi.mocked(validateUploadGroup).mockResolvedValue({
      data: validation({
        roles: { media: ['dive.mp4'], ignored: ['camera.npz'] },
        reasons: { 'camera.npz': 'Unsupported side file' },
      }),
    } as never);

    const wrapper = mountUpload();
    await wrapper.vm.openImport('video');

    const [row] = wrapper.vm.pendingUploads;
    expect(row.createSubFolders).toBe(false);
    expect(row.name).toBe('dive.mp4');
    expect(row.uploadFiles.map((f: File) => f.name)).toEqual(['dive.mp4']);
    expect(row.ignored).toEqual([{ name: 'camera.npz', reason: 'Unsupported side file' }]);
  });

  it('creates a row in an error state when validation rejects the selection', async () => {
    pick([file('img001.png'), file('tracks.csv')]);
    vi.mocked(validateUploadGroup).mockResolvedValue({
      data: rejection('Can only upload a single CSV Annotation per import'),
    } as never);

    const wrapper = mountUpload();
    await wrapper.vm.openImport('image-sequence');
    await nextTick();

    expect(wrapper.vm.pendingUploads).toHaveLength(1);
    const [row] = wrapper.vm.pendingUploads;
    expect(row.error).toBe('Can only upload a single CSV Annotation per import');
    expect(row.uploadFiles).toEqual([]);
    // The slot editor stays usable so the user can correct the selection in place.
    expect(row.createSubFolders).toBe(false);
    expect(row.mediaList.map((f: File) => f.name)).toEqual(['img001.png']);
    expect(wrapper.text()).toContain('Can only upload a single CSV Annotation per import');
  });

  it('leaves the media slot unfiltered while a row is in an error state', async () => {
    // Until the server accepts a selection the row's type is only the menu the user opened.
    // A TIFF folder picked from Import > Image Sequence validates as large-image, but a
    // rejected one keeps the image-sequence guess, whose accept filter excludes TIFF -- so
    // filtering by the guess would refuse the very files the user must re-pick.
    pick([file('a.tif'), file('tracks.csv'), file('nav.csv')]);
    vi.mocked(validateUploadGroup).mockResolvedValue({
      data: rejection('Can only upload a single CSV Annotation per import'),
    } as never);

    const wrapper = mountUpload();
    await wrapper.vm.openImport('image-sequence');
    await nextTick();

    const [row] = wrapper.vm.pendingUploads;
    expect(wrapper.vm.mediaSlotAccept(row)).toBeUndefined();
    row.error = null;
    expect(wrapper.vm.mediaSlotAccept(row)).toEqual(wrapper.vm.filterFileUpload(row.type));
  });

  it('names a corrected row when Start upload finally validates it', async () => {
    // The row exists only so the slot editor can fix the selection; until it validates the
    // server has named no media, so the row has no folder name to upload into.
    pick([file('a.mp4'), file('img.png')]);
    vi.mocked(validateUploadGroup).mockResolvedValueOnce({
      data: rejection('Do not upload images and videos in the same batch.'),
    } as never);
    const upload = vi.fn().mockResolvedValue(undefined);

    const wrapper = mountUpload(upload);
    await wrapper.vm.openImport('video');

    const [row] = wrapper.vm.pendingUploads;
    expect(row.name).toBe('');

    // The user drops the stray image in the slot editor, then starts the upload.
    row.mediaList = [file('a.mp4')];
    vi.mocked(validateUploadGroup).mockResolvedValue({
      data: validation({ roles: { media: ['a.mp4'] } }),
    } as never);
    await wrapper.vm.prepAndUpload(upload);

    expect(row.error).toBeNull();
    expect(row.name).toBe('a.mp4');
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('updates type from the server when Start upload validates a corrected error row', async () => {
    // Error rows leave the media slot unfiltered, so the user can replace a mixed
    // video pick with images. The folder must be created as image-sequence, not video.
    pick([file('a.mp4'), file('img.png')]);
    vi.mocked(validateUploadGroup).mockResolvedValueOnce({
      data: rejection('Do not upload images and videos in the same batch.'),
    } as never);
    const upload = vi.fn().mockResolvedValue(undefined);

    const wrapper = mountUpload(upload);
    await wrapper.vm.openImport('video');

    const [row] = wrapper.vm.pendingUploads;
    expect(row.type).toBe('video');

    row.mediaList = [file('img.png')];
    vi.mocked(validateUploadGroup).mockResolvedValue({
      data: validation({
        type: 'image-sequence',
        roles: { media: ['img.png'] },
      }),
    } as never);
    await wrapper.vm.prepAndUpload(upload);

    expect(row.error).toBeNull();
    expect(row.type).toBe('image-sequence');
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('lists every ignored file, including two that share a basename', async () => {
    // A selection spanning subfolders repeats basenames, and both copies are dropped, so the
    // notice has to name both — the list is keyed by position for that reason.
    pick([file('dive.mp4'), file('tracks.csv'), file('notes.csv'), file('notes.csv')]);
    vi.mocked(validateUploadGroup).mockResolvedValue({
      data: validation({ roles: { media: ['dive.mp4'], annotations: ['tracks.csv'] } }),
    } as never);

    const wrapper = mountUpload();
    await wrapper.vm.openImport('video');
    await nextTick();

    const [row] = wrapper.vm.pendingUploads;
    expect(row.ignored.map((entry: { name: string }) => entry.name)).toEqual(['notes.csv', 'notes.csv']);
    expect(wrapper.text().match(/notes\.csv/g)).toHaveLength(2);
  });

  it('retires the row the child names, not whichever row is last in the queue', async () => {
    vi.mocked(validateUploadGroup).mockImplementation(async (names: string[]) => ({
      data: validation({ roles: { media: names } }),
    }) as never);

    const wrapper = mountUpload();
    pick([file('a.mp4')]);
    await wrapper.vm.openImport('video');
    pick([file('b.mp4')]);
    await wrapper.vm.openImport('video');

    wrapper.findComponent({ name: 'UploadGirder' }).vm.$emit('remove-upload', wrapper.vm.pendingUploads[0]);

    expect(wrapper.vm.pendingUploads.map((row: { name: string }) => row.name)).toEqual(['b.mp4']);
  });

  it('starts only one upload when Start upload is clicked twice', async () => {
    pick([file('dive.mp4')]);
    vi.mocked(validateUploadGroup).mockResolvedValue({
      data: validation({ roles: { media: ['dive.mp4'] } }),
    } as never);
    const upload = vi.fn().mockResolvedValue(undefined);

    const wrapper = mountUpload(upload);
    await wrapper.vm.openImport('video');

    // Both clicks land before the awaited validation round-trip resolves.
    await Promise.all([wrapper.vm.prepAndUpload(upload), wrapper.vm.prepAndUpload(upload)]);

    expect(upload).toHaveBeenCalledTimes(1);
  });
});
