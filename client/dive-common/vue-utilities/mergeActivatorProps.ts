import { mergeProps } from 'vue';

type ActivatorProps = Record<string, unknown>;

/** Merge overlay activator props (menu, dialog) with extra button props. Do not merge tooltip activator props here — bind those on a wrapper element instead. */
export function mergeActivatorProps(...propsList: ActivatorProps[]): ActivatorProps {
  return mergeProps(...propsList);
}

export function menuOpensToSide(menuOptions: ActivatorProps): boolean {
  return Boolean(
    menuOptions.offsetX
    || menuOptions.right
    || menuOptions.location === 'end'
    || menuOptions.location === 'start',
  );
}
