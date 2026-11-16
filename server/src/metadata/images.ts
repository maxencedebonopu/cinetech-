// Cache local des images (TMDB, Wikimédia) : variantes WebP dimensionnées, blurhash, palette dominante.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { encode } from 'blurhash';
import { Vibrant } from 'node-vibrant/node';
import type { ImageRef, Palette } from '@cine/shared';
import { paths } from '../config.ts';

export const IMAGE_SIZES = {
  poster: [200, 342, 500, 780],
  backdrop: [780, 1280, 1920],
  logo: [300, 600],
  profile: [185],
} as const;

export async function fetchBuffer(url: string, headers?: Record<string, string>): Promise<Buffer> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status !== 429 && res.status < 500) throw new Error(`Image ${res.status} : ${url}`);
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  throw new Error(`Image indisponible : ${url}`);
}

async function blurhashOf(buf: Buffer, w: number, h: number) {
  const tw = 32;
  const th = Math.max(1, Math.round((tw * h) / w));
  const { data, info } = await sharp(buf).resize(tw, th, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cx = w >= h ? 4 : 3;
  const cy = w >= h ? 3 : 4;
  return encode(new Uint8ClampedArray(data), info.width, info.height, cx, cy);
}

/** Enregistre une image en variantes WebP ; renvoie la référence (avec blurhash). */
export async function storeImage(buf: Buffer, base: string, kind: keyof typeof IMAGE_SIZES): Promise<ImageRef> {
  const img = sharp(buf);
  const meta = await img.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const widths: number[] = [];
  for (const w of IMAGE_SIZES[kind]) {
    if (w > width && widths.length) continue; // pas d'agrandissement
    const target = Math.min(w, width);
    const out = path.join(paths.images, `${base}-${w}.webp`);
    await sharp(buf)
      .resize({ width: target, withoutEnlargement: true })
      .webp({ quality: kind === 'backdrop' ? 78 : 82, alphaQuality: 90, effort: 4 })
      .toFile(out);
    widths.push(w);
  }
  const blurhash = kind === 'logo' ? '' : await blurhashOf(buf, width, height);
  return { base, widths, width, height, blurhash };
}

export function imageExists(ref: ImageRef | null) {
  return !!ref && fs.existsSync(path.join(paths.images, `${ref.base}-${ref.widths[0]}.webp`));
}

// ---------- Palette ----------

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance([r, g, b]: number[]) {
  const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const BG_LUM = luminance(hexToRgb('#0D0B09'));
export function contrastOnBg(hex: string) {
  return (luminance(hexToRgb(hex)) + 0.05) / (BG_LUM + 0.05);
}
function rgbToHsl([r, g, b]: number[]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hslToHex([h, s, l]: number[]) {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Choisit un accent lisible (AA ≥ 4.5 sur le noir chaud), en éclaircissant si nécessaire. */
function pickAccent(p: Omit<Palette, 'accent'>): string {
  const order = [p.vibrant, p.lightVibrant, p.muted, p.lightMuted, p.darkVibrant].filter(Boolean) as string[];
  // Préférence : la couleur la plus saturée qui reste lisible.
  const scored = order.map((hex) => ({ hex, hsl: rgbToHsl(hexToRgb(hex)) })).sort((a, b) => b.hsl[1] - a.hsl[1]);
  for (const c of scored) if (c.hsl[1] > 0.25 && contrastOnBg(c.hex) >= 4.5) return c.hex;
  const base = scored.find((c) => c.hsl[1] > 0.2) ?? scored[0];
  if (!base) return '#C9A86A';
  let [h, s, l] = base.hsl;
  s = Math.min(Math.max(s, 0.35), 0.75);
  let hex = hslToHex([h, s, l]);
  while (contrastOnBg(hex) < 4.5 && l < 0.92) { l += 0.03; hex = hslToHex([h, s, l]); }
  return hex;
}

export async function extractPalette(buf: Buffer): Promise<Palette> {
  const small = await sharp(buf).resize(200).png().toBuffer();
  const pal = await Vibrant.from(small).getPalette();
  const p = {
    vibrant: pal.Vibrant?.hex,
    darkVibrant: pal.DarkVibrant?.hex,
    lightVibrant: pal.LightVibrant?.hex,
    muted: pal.Muted?.hex,
    darkMuted: pal.DarkMuted?.hex,
    lightMuted: pal.LightMuted?.hex,
  };
  return { ...p, accent: pickAccent(p) };
}
