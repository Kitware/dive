/* eslint-disable no-param-reassign, new-cap -- legacy GWC uploader mixin */
import { UploadManager } from '@girder/components';

import { getByValue } from '../girder-jobs/status';
import { formatJob } from '../girder-jobs/jobFormatter';

export const sizeFormatter = {
  methods: {
    formatSize(size: number, { base = 1024, unit = 'B' } = {}) {
      if (size < base) {
        return `${size} ${unit}`;
      }
      let i = 0;
      let val = size;
      for (i = 0; val >= base && i < 4; i += 1) {
        val /= base;
      }
      return `${val.toFixed(2)} ${['', 'K', 'M', 'G', 'T'][i]}${unit}`;
    },
  },
};

export const progressReporter = {
  methods: {
    progressPercent(progress: { current?: number; total?: number }) {
      if (!progress.total) {
        return 0;
      }
      return Math.round((100 * (progress.current || 0)) / progress.total);
    },
  },
};

export const jobFormatter = {
  methods: {
    formatJob,
    progressAsNumber(progress?: { current: number; total: number }) {
      if (!progress?.total) {
        return 100;
      }
      return 100 * (progress.current / progress.total);
    },
  },
};

export const fileUploader = {
  inject: ['girderRest'],
  data() {
    return {
      errorMessage: null as string | null,
      files: [] as Array<Record<string, unknown>>,
      uploading: false,
      indeterminate: false,
    };
  },
  watch: {
    files(val: unknown[]) {
      this.$emit('filesChanged', val);
    },
  },
  computed: {
    totalProgress(): number {
      return this.files.reduce((v, f) => v + ((f.progress as { current: number }).current || 0), 0);
    },
    totalSize(): number {
      return this.files.reduce((v, f) => v + (f.file as File).size, 0);
    },
    totalProgressPercent(): number {
      return this.progressPercent({
        current: this.totalProgress,
        total: this.totalSize,
      });
    },
  },
  methods: {
    reset() {
      this.files = [];
      this.errorMessage = null;
      this.uploading = false;
      this.indeterminate = false;
    },
    setFiles(files: Array<Record<string, unknown>>) {
      this.files = files;
    },
    progressPercent(progress: { current?: number; total?: number }) {
      if (!progress.total) {
        return 0;
      }
      return Math.round((100 * (progress.current || 0)) / progress.total);
    },
    uploadFile({
      file,
      hookResult,
      dest,
      uploadCls,
    }: {
      file: Record<string, unknown>;
      hookResult: { dest?: unknown };
      dest: unknown;
      uploadCls: typeof UploadManager;
    }) {
      if (file.status === 'done') {
        return Promise.resolve(file.result);
      }
      const progress = (event: { current: number; total: number }) => {
        file.progress = event;
      };
      file.status = 'uploading';
      (file.progress as { indeterminate: boolean }).indeterminate = true;
      let promiseChain = Promise.resolve();
      if (file.upload) {
        promiseChain = promiseChain.then(() => (file.upload as { resume: () => Promise<unknown> }).resume());
      } else {
        file.upload = new uploadCls(file.file as File, {
          $rest: this.girderRest,
          parent: (hookResult && hookResult.dest) ? hookResult.dest : dest,
          progress,
          params: file.uploadClsParams,
        });
        promiseChain = promiseChain
          .then(() => (file.upload as { beforeUpload: () => Promise<unknown> }).beforeUpload())
          .then(() => (file.upload as { start: () => Promise<unknown> }).start());
      }
      return promiseChain
        .then(async (result) => {
          await (file.upload as { afterUpload: () => Promise<unknown> }).afterUpload();
          delete file.upload;
          file.status = 'done';
          (file.progress as { current: number }).current = (file.file as File).size;
          return { ...result as object, file: file.file };
        })
        .catch(async (error: { response?: { data: { message?: string } } }) => {
          await (file.upload as { onError: (e: unknown) => Promise<unknown> }).onError(error);
          if (error.response) {
            this.errorMessage = error.response.data.message || 'An error occurred during upload.';
          } else {
            this.errorMessage = 'Connection failed.';
          }
          file.status = 'error';
          this.uploading = false;
          this.$emit('error', { error, file });
          throw error;
        });
    },
    async start({
      dest,
      preUpload = async () => ({}),
      postUpload = async () => {},
      uploadCls = UploadManager,
    }: {
      dest: unknown;
      preUpload?: () => Promise<unknown>;
      postUpload?: (args: { results: unknown[] }) => Promise<void>;
      uploadCls?: typeof UploadManager;
    }) {
      this.uploading = true;
      this.indeterminate = true;
      this.errorMessage = null;
      const hookResult = await preUpload();
      this.indeterminate = false;
      const results: unknown[] = [];
      let i = 0;
      const workerPool = [...new Array(5)];
      await Promise.all(workerPool.map(async () => {
        while (i < this.files.length) {
          const file = this.files[i];
          i += 1;
          // eslint-disable-next-line no-await-in-loop
          results.push(await this.uploadFile({
            file, hookResult, dest, uploadCls,
          }));
        }
      }));
      this.indeterminate = true;
      await postUpload({ results });
      this.indeterminate = false;
      this.uploading = false;
      this.files = [];
      this.$emit('done', results);
    },
  },
};

export const mixins = {
  sizeFormatter,
  progressReporter,
  jobFormatter,
  fileUploader,
};

export { getByValue };
