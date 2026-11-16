// Sous-titres : décodage (Windows-1252, UTF-16…), détection de langue, conversion SRT/ASS → WebVTT,
// extraction des pistes texte intégrées au MKV.
import fs from 'node:fs';
import path from 'node:path';
import chardet from 'chardet';
import { paths } from '../config.ts';
import { ffmpegPath, run } from '../tools/ffmpeg.ts';

// ---------- Décodage ----------

export function decodeText(buf: Buffer): { text: string; encoding: string } {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.subarray(3).toString('utf8'), encoding: 'utf-8' };
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'utf-16le' };
  if (buf[0] === 0xfe && buf[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'utf-16be' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf-8' };
  } catch { /* pas de l'UTF-8 valide */ }
  const guess = chardet.detect(buf);
  // chardet confond souvent ISO-8859-1 et Windows-1252 ; 1252 est un sur-ensemble, on le préfère.
  const label = !guess || /iso-8859-1|ascii/i.test(guess) ? 'windows-1252' : guess.toLowerCase();
  try {
    return { text: new TextDecoder(label).decode(buf), encoding: label };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(buf), encoding: 'windows-1252' };
  }
}

// ---------- Détection de langue par le contenu ----------

const STOPWORDS: Record<string, string[]> = {
  fr: ['le', 'la', 'les', 'de', 'des', 'est', 'et', 'je', 'tu', 'vous', 'pas', 'que', 'qui', 'une', 'un', 'il', 'elle', 'on', 'ce', 'ça', 'moi', 'toi', 'nous', 'mais', 'oui', 'non', 'avec', 'pour', 'dans', 'suis', "c'est", "j'ai"],
  en: ['the', 'you', 'and', 'is', 'to', 'of', 'it', 'that', 'what', 'i', 'me', 'my', 'your', 'we', 'he', 'she', 'this', 'are', 'was', 'have', 'not', "don't", "i'm", "it's", 'yes', 'no', 'with', 'for', 'just', 'know'],
  es: ['el', 'la', 'que', 'de', 'y', 'no', 'es', 'en', 'lo', 'los', 'un', 'una', 'por', 'qué', 'me', 'te', 'se', 'pero', 'sí', 'está', 'como', 'para', 'muy', 'yo'],
  it: ['il', 'che', 'non', 'di', 'è', 'e', 'la', 'un', 'per', 'mi', 'ti', 'ho', 'sono', 'ma', 'cosa', 'questo', 'una', 'gli', 'lo', 'sei', 'come', 'bene', 'perché'],
  de: ['der', 'die', 'und', 'ich', 'du', 'nicht', 'das', 'ist', 'es', 'sie', 'wir', 'ein', 'zu', 'mit', 'was', 'ja', 'nein', 'mir', 'auf', 'aber', 'den', 'dich'],
  pt: ['não', 'que', 'de', 'o', 'a', 'é', 'e', 'você', 'eu', 'um', 'uma', 'se', 'para', 'com', 'isso', 'está', 'do', 'da', 'mas', 'sim', 'meu'],
};

export function detectLanguage(text: string): string | null {
  const sample = text.slice(0, 60_000);
  const kana = (sample.match(/[぀-ヿ]/g) ?? []).length;
  const han = (sample.match(/[一-鿿]/g) ?? []).length;
  const hangul = (sample.match(/[가-힯]/g) ?? []).length;
  const cyr = (sample.match(/[Ѐ-ӿ]/g) ?? []).length;
  const arab = (sample.match(/[؀-ۿ]/g) ?? []).length;
  if (kana > 50) return 'ja';
  if (hangul > 50) return 'ko';
  if (han > 100) return 'zh';
  if (cyr > 200) return 'ru';
  if (arab > 200) return 'ar';

  const words = sample
    .replace(/<[^>]+>|\{[^}]+\}/g, ' ')
    .toLowerCase()
    .match(/[\p{L}']+/gu) ?? [];
  if (words.length < 30) return null;
  const counts: Record<string, number> = {};
  const sets = Object.fromEntries(Object.entries(STOPWORDS).map(([k, v]) => [k, new Set(v)]));
  for (const w of words) for (const [lang, set] of Object.entries(sets)) if (set.has(w)) counts[lang] = (counts[lang] ?? 0) + 1;
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const [best, score] = ranked[0];
  const second = ranked[1]?.[1] ?? 0;
  return score / words.length > 0.08 && score > second * 1.4 ? best : null;
}

// ---------- Conversion vers WebVTT ----------

const TIME_SRT = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function fmtTime(sec: number) {
  if (sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
function parseTime(t: string) {
  const m = t.match(TIME_SRT);
  if (!m) return NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

/** Balises ASS courantes dans les SRT ({\an8} = en haut, {\i1} = italique…) */
function srtLineToVtt(text: string): { text: string; settings: string } {
  let settings = '';
  const an = text.match(/\{\\an(\d)\}/);
  if (an) {
    const pos = Number(an[1]);
    if (pos >= 7) settings = ' line:5%';
    else if (pos >= 4) settings = ' line:50%';
    if (pos % 3 === 1) settings += ' align:start position:10%';
    if (pos % 3 === 0) settings += ' align:end position:90%';
  }
  const out = text
    .replace(/\{\\i1\}/g, '<i>').replace(/\{\\i0\}/g, '</i>')
    .replace(/\{\\b1\}/g, '<b>').replace(/\{\\b0\}/g, '</b>')
    .replace(/\{[^}]*\}/g, '')
    .replace(/<font[^>]*>|<\/font>/gi, '')
    .replace(/&(?!amp;|lt;|gt;)/g, '&amp;');
  return { text: out, settings };
}

export function srtToVtt(srt: string): string {
  const blocks = srt.replace(/\r\n?/g, '\n').replace(/^﻿/, '').split(/\n{2,}/);
  const out: string[] = ['WEBVTT', ''];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '' || false);
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    const start = parseTime(a);
    const end = parseTime(b);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    const body = lines.slice(ti + 1).join('\n');
    if (!body.trim()) continue;
    const { text, settings } = srtLineToVtt(body);
    out.push(`${fmtTime(start)} --> ${fmtTime(end)}${settings}`, text, '');
  }
  return out.join('\n');
}

/** Conversion ASS/SSA simplifiée : on garde le texte, l'italique et la position verticale. */
export function assToVtt(ass: string): string {
  const lines = ass.replace(/\r\n?/g, '\n').split('\n');
  let format: string[] = [];
  const cues: { start: number; end: number; text: string; settings: string }[] = [];
  let inEvents = false;
  for (const line of lines) {
    if (/^\[events\]/i.test(line)) { inEvents = true; continue; }
    if (/^\[/.test(line)) { inEvents = false; continue; }
    if (!inEvents) continue;
    if (/^format:/i.test(line)) { format = line.slice(7).split(',').map((s) => s.trim().toLowerCase()); continue; }
    if (!/^dialogue:/i.test(line) || !format.length) continue;
    const parts = line.slice(9).split(',');
    const fields = parts.slice(0, format.length - 1).concat(parts.slice(format.length - 1).join(','));
    const get = (k: string) => fields[format.indexOf(k)]?.trim() ?? '';
    const t = (s: string) => { const [h, m, rest] = s.split(':'); return Number(h) * 3600 + Number(m) * 60 + Number(rest); };
    const raw = get('text').replace(/\\N/gi, '\n').replace(/\\h/g, ' ');
    const { text, settings } = srtLineToVtt(raw);
    if (!text.trim()) continue;
    cues.push({ start: t(get('start')), end: t(get('end')), text, settings });
  }
  cues.sort((a, b) => a.start - b.start);
  return ['WEBVTT', '', ...cues.flatMap((c) => [`${fmtTime(c.start)} --> ${fmtTime(c.end)}${c.settings}`, c.text, ''])].join('\n');
}

// ---------- Accès aux pistes ----------

export function readExternal(filePath: string) {
  const { text, encoding } = decodeText(fs.readFileSync(filePath));
  return { text, encoding };
}

export function externalToVtt(filePath: string): string {
  const { text } = readExternal(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.vtt') return text.startsWith('WEBVTT') ? text : `WEBVTT\n\n${text}`;
  if (ext === '.ass' || ext === '.ssa') return assToVtt(text);
  return srtToVtt(text);
}

/** Extrait une piste texte intégrée (SRT/ASS) en WebVTT, avec cache disque. */
export async function embeddedToVtt(moviePath: string, streamIndex: number, cacheKey: string): Promise<string> {
  const cacheFile = path.join(paths.cache, 'subs', `${cacheKey}.vtt`);
  if (fs.existsSync(cacheFile)) return fs.readFileSync(cacheFile, 'utf8');
  if (!ffmpegPath) throw new Error('ffmpeg introuvable');
  const buf = await run(ffmpegPath, ['-v', 'error', '-i', moviePath, '-map', `0:${streamIndex}`, '-c:s', 'webvtt', '-f', 'webvtt', '-'], { timeoutMs: 180_000 });
  const vtt = buf.toString('utf8');
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, vtt);
  return vtt;
}
