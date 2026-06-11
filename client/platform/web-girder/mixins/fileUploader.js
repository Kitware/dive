import { UploadManager } from '@girder/components';

export default {
  inject: ['girderRest'],

  data() {
    return {
      errorMessage: null,
      files: [],
      uploading: false,
      indeterminate: false,
    };
  },

  watch: {
    files(val) {
      this.$emit('filesChanged', val);
    },
  },

  computed: {
    totalProgress() {
      return this.files.reduce((v, f) => v + f.progress.current, 0);
    },
    totalSize() {
      return this.files.reduce((v, f) => v + f.file.size, 0);
    },
    totalProgressPercent() {
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

    inputFilesChanged(files) {
      this.files = files.map((file) => ({
        file,
        status: 'pending',
        progress: {
          indeterminate: false,
          current: 0,
          size: file.size,
        },
        upload: null,
        result: null,
        uploadClsParams: {},
      }));
    },

    setFiles(files) {
      this.files = files;
    },

    uploadFile({
      file,
      hookResult,
      dest,
      uploadCls,
    }) {
      let promiseChain = Promise.resolve();
      if (file.status === 'done') {
        return promiseChain.then(() => file.result);
      }
      const progress = (event) => {
        Object.assign(file.progress, event);
      };
      file.status = 'uploading';
      file.progress.indeterminate = true;
      if (file.upload) {
        promiseChain = promiseChain.then(() => file.upload.resume());
      } else {
        file.upload = new uploadCls(file.file, {
          $rest: this.girderRest,
          parent: (hookResult && hookResult.dest) ? hookResult.dest : dest,
          progress,
          params: file.uploadClsParams,
        });
        promiseChain = promiseChain
          .then(() => file.upload.beforeUpload())
          .then(() => file.upload.start());
      }
      return promiseChain
        .then(async (result) => {
          await file.upload.afterUpload();
          delete file.upload;
          file.status = 'done';
          file.progress.current = file.file.size;
          result.file = file.file;
          return result;
        })
        .catch(async (error) => {
          await file.upload.onError(error);
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
      preUpload = async () => {},
      postUpload = async () => {},
      uploadCls = UploadManager,
    }) {
      this.uploading = true;
      this.indeterminate = true;
      this.errorMessage = null;
      const hookResult = await preUpload();
      this.indeterminate = false;
      const results = [];
      let i = 0;
      const WORKER_POOL_SIZE = 5;
      const workerPool = [...new Array(WORKER_POOL_SIZE)];
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
