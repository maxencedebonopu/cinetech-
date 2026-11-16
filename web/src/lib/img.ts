import type { ImageRef } from '@cine/shared';

export const imgUrl = (ref: ImageRef, w: number) => `/images/${ref.base}-${w}.webp`;

/** srcset réel : la plus petite variante peut être plus étroite que son nom (pas d'agrandissement). */
export const srcSet = (ref: ImageRef) =>
  ref.widths.map((w) => `${imgUrl(ref, w)} ${Math.min(w, ref.width)}w`).join(', ');

export const largest = (ref: ImageRef) => imgUrl(ref, ref.widths[ref.widths.length - 1]);
