/**
 * Shared import-dialog context passed as the `ctx` prop.
 *
 * `ImportMultiCamContext` is the return type of `useImportMultiCamDialog()` — reactive
 * refs, computeds, and methods shared across mode panels (multi / subfolders / keyword).
 * It is not the shell's platform props (`importMedia`, `stereo`, etc.).
 *
 * Usage:
 * - Shell: `const ctx = useImportMultiCamDialog(props, emit)` then `:ctx="ctx"` on panels.
 * - Panel: `props: { ...importMultiCamContextProp, … }`, `setup(props) { …props.ctx }`.
 * - Nested panel children: parent forwards `:ctx="ctx"` when they need the same handlers.
 *
 * @see README.md § Shared context (`ctx`)
 */
import { PropType } from 'vue';
import type { useImportMultiCamDialog } from 'dive-common/components/ImportMultiCamDialog/useImportMultiCamDialog';

export type ImportMultiCamContext = ReturnType<typeof useImportMultiCamDialog>;

/** Required `ctx` prop for components that read shared dialog state from the composable. */
export const importMultiCamContextProp = {
  ctx: {
    type: Object as PropType<ImportMultiCamContext>,
    required: true,
  },
};
