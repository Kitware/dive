import type { Pipe } from 'dive-common/apispec';

/**
 * Whether the pipeline exposes any DIVE_PARAM values for the user to tune.
 * These are reachable from the gear on the pipeline's menu entry.
 */
export function pipelineHasParams(pipe: Pipe): boolean {
  return (pipe.metadata?.diveParams?.length ?? 0) > 0;
}

/**
 * Whether the pipeline cannot run until the user supplies values.
 *
 * Only params flagged `required` force the dialog. Every other param already
 * carries the value written in the .pipe file, so running without opening the
 * dialog is the same as accepting those defaults -- which is why a plain click
 * on the entry runs rather than configures.
 */
export function pipelineRequiresParams(pipe: Pipe): boolean {
  return pipe.metadata?.diveParams?.some((param) => param.required === true) ?? false;
}
