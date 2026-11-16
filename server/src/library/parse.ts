// Reconnaissance du titre, de l'année et de la langue à partir des noms de fichiers.
// Gère « Titre (Année).mkv », le style scène « Titre.Année.1080p.BluRay... » et les variantes.

import path from 'node:path';

const SEP = /[\s._\-()[\]{}+,]+/;

/** Jetons qui marquent la fin du titre (qualité, source, codec, langue de release…). */
const STOP_TOKENS = new Set([
  '2160p', '1080p', '1080i', '720p', '576p', '480p', '4k', 'uhd', 'hd', 'fhd', 'sd',
  'bluray', 'blu', 'bdrip', 'brrip', 'bdremux', 'remux', 'webrip', 'web', 'webdl', 'dl', 'hdtv', 'dvdrip', 'dvd', 'hddvd', 'hdcam', 'cam', 'amzn', 'nf', 'hmax',
  'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'av1', 'xvid', 'divx', 'vc1', '10bit', '8bit', 'hdr', 'hdr10', 'sdr', 'dv',
  'aac', 'ac3', 'eac3', 'dts', 'dtshd', 'truehd', 'atmos', 'ddp', 'dd', 'opus', 'flac', 'mp3',
  'multi', 'truefrench', 'french', 'vff', 'vfq', 'vostfr', 'subfrench', 'english', 'japanese', 'proper', 'repack', 'limited', 'internal',
  'remastered', 'restored', 'uncut', 'unrated', 'extended', 'criterion', 'directors', 'docu', 'complet', 'mp4', 'mkv', 'avi', 'esub', 'subs',
]);

/** Suffixes de langue dans les noms de sous-titres → code ISO 639-1. */
const LANG_TOKENS: Record<string, string> = {
  fr: 'fr', fre: 'fr', fra: 'fr', french: 'fr', francais: 'fr', truefrench: 'fr', vostfr: 'fr', vff: 'fr', vfq: 'fr', vf: 'fr', subfrench: 'fr',
  en: 'en', eng: 'en', english: 'en', anglais: 'en',
  es: 'es', spa: 'es', spanish: 'es', esp: 'es',
  de: 'de', ger: 'de', deu: 'de', german: 'de',
  it: 'it', ita: 'it', italian: 'it',
  pt: 'pt', por: 'pt', portuguese: 'pt', ptbr: 'pt',
  ja: 'ja', jpn: 'ja', japanese: 'ja',
  ko: 'ko', kor: 'ko', korean: 'ko',
  zh: 'zh', chi: 'zh', zho: 'zh', chinese: 'zh',
  nl: 'nl', dut: 'nl', nld: 'nl',
  ru: 'ru', rus: 'ru',
  ar: 'ar', ara: 'ar',
};
// Codes de deux lettres trop ambigus au milieu d'un titre : on ne les reconnaît qu'en toute fin de nom.
const AMBIGUOUS_LANG = new Set(['it', 'de', 'es', 'pt', 'en', 'ja', 'ko', 'nl', 'ar', 'ru', 'zh']);

export interface ParsedName {
  title: string;
  year: number | null;
  edition: string | null;
}

export interface ParsedSubtitleName extends ParsedName {
  language: string | null;
  forced: boolean;
  sdh: boolean;
}

function stripExtensions(fileName: string) {
  let base = path.basename(fileName);
  // Retire toutes les extensions vidéo/sous-titres, y compris les doublons du type « film.mkv-[xpost].mkv »
  base = base.replace(/\.(srt|vtt|ass|ssa|sub|idx)$/i, '');
  base = base.replace(/\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts|wmv|mpg|mpeg)$/i, '');
  base = base.replace(/\.(mkv|mp4|avi)(?=[-_\s[]|$).*$/i, '');
  // Groupe de release en tête : « [niizk-Fussoir] Millennium Actress … »
  base = base.replace(/^\s*\[[^\]]*\]\s*/, '');
  return base;
}

function cleanTitle(raw: string) {
  let t = raw.replace(/[._]+/g, ' ').replace(/\s*[-–]\s*$/, '').replace(/[([{\s-]+$/, '').replace(/^[\s\-–([{]+/, '');
  t = t.replace(/\s+/g, ' ').trim();
  // Titre tout en minuscules (« chungking express ») → casse de titre
  if (t && t === t.toLowerCase()) t = t.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  return t;
}

const YEAR_RE = /(?<=^|[\s._\-([{])((?:19|20)\d{2})(?=$|[\s._\-)\]}])/g;

export function parseName(fileName: string): ParsedName {
  const base = stripExtensions(fileName);
  const currentYear = new Date().getFullYear() + 1;

  // Toutes les années candidates ; on ignore une année en tout début de nom (« 1917 (2019) », « 2001… »)
  const candidates: { year: number; index: number }[] = [];
  for (const m of base.matchAll(YEAR_RE)) {
    const y = Number(m[1]);
    if (y < 1888 || y > currentYear) continue;
    if (m.index === 0) continue;
    candidates.push({ year: y, index: m.index! });
  }

  // Position du premier jeton technique : l'année doit le précéder
  const tokens = [...base.matchAll(/[^\s._\-()[\]{}+,]+/g)];
  let stopIndex = base.length;
  for (const t of tokens) {
    if (t.index === 0) continue;
    if (STOP_TOKENS.has(t[0].toLowerCase().replace(/[^a-z0-9]/g, ''))) { stopIndex = t.index!; break; }
  }
  // Un crochet ouvrant après le début marque aussi la fin du titre (« Blade.Runner[Remastered…] »)
  const bracket = base.search(/(?<=.)\[/);
  if (bracket > 0 && bracket < stopIndex) stopIndex = bracket;

  const before = candidates.filter((c) => c.index < stopIndex);
  const chosen = before.length ? before[before.length - 1] : candidates[0];

  if (chosen) {
    const title = cleanTitle(base.slice(0, chosen.index));
    // Édition : les mots entre l'année et le premier jeton technique (« The Final Cut »)
    const editionWords: string[] = [];
    for (const w of base.slice(chosen.index + 4).split(SEP).filter(Boolean)) {
      if (STOP_TOKENS.has(w.toLowerCase().replace(/[^a-z0-9]/g, ''))) break;
      editionWords.push(w);
    }
    const edition = editionWords.join(' ').trim();
    if (title) return { title, year: chosen.year, edition: edition && edition.length < 40 ? edition : null };
  }

  return { title: cleanTitle(base.slice(0, stopIndex)) || cleanTitle(base), year: null, edition: null };
}

export function parseSubtitleName(fileName: string): ParsedSubtitleName {
  const base = stripExtensions(fileName);
  const parsed = parseName(fileName);
  const toks = base.split(SEP).filter(Boolean).map((t) => t.toLowerCase());

  let language: string | null = null;
  let forced = false;
  let sdh = false;
  toks.forEach((tok, i) => {
    const clean = tok.replace(/[^a-z]/g, '');
    if (clean === 'forced' || clean === 'force') forced = true;
    if (clean === 'sdh' || clean === 'cc' || clean === 'hi') sdh = true;
    const lang = LANG_TOKENS[clean];
    if (!lang) return;
    const isLast = i >= toks.length - 2;
    if (AMBIGUOUS_LANG.has(clean) && !isLast) return;
    language = lang; // le dernier jeton de langue l'emporte (« [Eng]-aXXo.FR » → fr)
  });
  // Variante collée en fin de nom : « …anoXmous_0.fr », « …-RARBG_french »
  const tail = base.match(/[._\-\s]([a-z]{2,10})$/i)?.[1]?.toLowerCase();
  if (tail && LANG_TOKENS[tail]) language = LANG_TOKENS[tail];

  return { ...parsed, language, forced, sdh };
}

/** Normalisation pour comparer des titres : minuscules, sans accents, sans article initial ni ponctuation. */
export function normalizeTitle(t: string) {
  return t
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an|le|la|les|l|un|une) /, '')
    .trim();
}

export function similarity(a: string, b: string) {
  a = normalizeTitle(a);
  b = normalizeTitle(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length);
}

function levenshtein(a: string, b: string) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}
