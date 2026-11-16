// Client TMDB : recherche, choix du meilleur résultat, fiche complète, images.
import type { Person, TmdbSearchResult } from '@cine/shared';
import { config } from '../config.ts';
import { getSettings } from '../db.ts';
import { similarity } from '../library/parse.ts';

const API = 'https://api.themoviedb.org/3';
export const IMG = 'https://image.tmdb.org/t/p';

export function tmdbKey() {
  return config.tmdbKey;
}
export function tmdbEnabled() {
  return tmdbKey().length > 0;
}

let inflight = 0;
const queue: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (inflight >= 6) await new Promise<void>((r) => queue.push(r));
  inflight++;
  try { return await fn(); } finally { inflight--; queue.shift()?.(); }
}

async function tmdb<T>(pathname: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const key = tmdbKey();
  if (!key) throw new Error('Clé TMDB absente');
  const url = new URL(API + pathname);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const bearer = key.startsWith('eyJ');
  if (!bearer) url.searchParams.set('api_key', key);
  return slot(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(url, { headers: { accept: 'application/json', ...(bearer ? { authorization: `Bearer ${key}` } : {}) } });
      if (res.ok) return (await res.json()) as T;
      if (res.status === 401) throw new Error('Clé TMDB refusée (401)');
      if (res.status === 404) throw new Error('Film introuvable sur TMDB (404)');
      if (res.status !== 429 && res.status < 500) throw new Error(`TMDB ${res.status}`);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    throw new Error('TMDB indisponible');
  });
}

interface RawResult {
  id: number;
  title: string;
  original_title: string;
  release_date?: string;
  overview: string;
  poster_path: string | null;
  popularity: number;
  vote_count: number;
}

const yearOf = (d?: string) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);

export async function searchMovies(query: string, year?: number | null): Promise<TmdbSearchResult[]> {
  const lang = getSettings().tmdbLanguage;
  const r = await tmdb<{ results: RawResult[] }>('/search/movie', { query, year: year ?? undefined, language: lang, include_adult: 'false' });
  return r.results.map(toResult);
}

function toResult(r: RawResult): TmdbSearchResult {
  return {
    tmdbId: r.id,
    title: r.title,
    originalTitle: r.original_title,
    year: yearOf(r.release_date),
    overview: r.overview,
    posterUrl: r.poster_path ? `${IMG}/w185${r.poster_path}` : null,
  };
}

/** Recherche automatique : renvoie le meilleur candidat et un score de confiance (0..1). */
export async function autoMatch(title: string, year: number | null): Promise<{ id: number; score: number } | null> {
  const lang = getSettings().tmdbLanguage;
  const attempts: Record<string, string | number | undefined>[] = [];
  if (year) attempts.push({ query: title, primary_release_year: year }, { query: title, year });
  attempts.push({ query: title });

  const seen = new Map<number, RawResult>();
  for (const p of attempts) {
    const r = await tmdb<{ results: RawResult[] }>('/search/movie', { ...p, language: lang, include_adult: 'false' });
    for (const x of r.results.slice(0, 10)) seen.set(x.id, x);
    if (r.results.length && year && seen.size >= 1 && [...seen.values()].some((x) => yearOf(x.release_date) === year)) break;
  }
  if (!seen.size) return null;

  const maxPop = Math.max(...[...seen.values()].map((x) => x.vote_count), 1);
  let best: { id: number; score: number } | null = null;
  for (const x of seen.values()) {
    const titleSim = Math.max(similarity(title, x.title), similarity(title, x.original_title));
    const y = yearOf(x.release_date);
    const yearScore = !year || !y ? 0.5 : y === year ? 1 : Math.abs(y - year) === 1 ? 0.75 : 0;
    const pop = Math.log10(1 + x.vote_count) / Math.log10(1 + maxPop);
    const score = titleSim * 0.6 + yearScore * 0.3 + pop * 0.1;
    if (!best || score > best.score) best = { id: x.id, score };
  }
  return best;
}

// ---------- Fiche complète ----------

interface RawDetail {
  id: number;
  title: string;
  original_title: string;
  original_language: string;
  release_date: string;
  overview: string;
  tagline: string;
  runtime: number | null;
  genres: { id: number; name: string }[];
  production_countries: { iso_3166_1: string; name: string }[];
  poster_path: string | null;
  backdrop_path: string | null;
  credits: {
    cast: { id: number; name: string; character: string; order: number }[];
    crew: { id: number; name: string; job: string; department: string }[];
  };
  images: {
    logos: { file_path: string; iso_639_1: string | null; vote_average: number; width: number; aspect_ratio: number }[];
    backdrops: { file_path: string; iso_639_1: string | null; vote_average: number; width: number }[];
    posters: { file_path: string; iso_639_1: string | null; vote_average: number }[];
  };
}

const KEY_JOBS = ['Director', 'Screenplay', 'Writer', 'Novel', 'Director of Photography', 'Original Music Composer', 'Editor', 'Production Design', 'Producer', 'Costume Design'];

export interface MovieMetadata {
  tmdbId: number;
  title: string;
  originalTitle: string;
  originalLanguage: string;
  year: number | null;
  releaseDate: string | null;
  overview: string;
  tagline: string;
  runtime: number | null;
  genres: string[];
  countries: string[];
  directors: string[];
  cast: Person[];
  crew: Person[];
  posterUrl: string | null;
  backdropUrl: string | null;
  logoUrl: string | null;
}

export async function getMovie(id: number): Promise<MovieMetadata> {
  const settings = getSettings();
  const lang = settings.tmdbLanguage;
  const short = lang.split('-')[0];
  const d = await tmdb<RawDetail>(`/movie/${id}`, {
    language: lang,
    append_to_response: 'credits,images',
    include_image_language: `${short},en,null`,
  });

  const regionNames = new Intl.DisplayNames([short], { type: 'region' });
  const crew: Person[] = [];
  const seenCrew = new Set<string>();
  for (const job of KEY_JOBS) {
    for (const c of d.credits.crew.filter((c) => c.job === job)) {
      const k = `${c.id}:${job}`;
      if (seenCrew.has(k)) continue;
      seenCrew.add(k);
      crew.push({ id: c.id, name: c.name, job });
    }
  }

  // Logo : langue de l'interface, sinon anglais, sinon sans texte ; le mieux noté.
  const pickLogo = () => {
    const logos = d.images.logos.filter((l) => !l.file_path.endsWith('.svg'));
    for (const l of [short, 'en', null]) {
      const c = logos.filter((x) => x.iso_639_1 === l).sort((a, b) => b.vote_average - a.vote_average);
      if (c.length) return c[0].file_path;
    }
    return null;
  };
  // Fond : de préférence sans texte (iso null), le mieux noté.
  const textless = d.images.backdrops.filter((b) => b.iso_639_1 === null).sort((a, b) => b.vote_average - a.vote_average);
  const backdrop = textless[0]?.file_path ?? d.backdrop_path;
  const logo = pickLogo();

  return {
    tmdbId: d.id,
    title: d.title,
    originalTitle: d.original_title,
    originalLanguage: d.original_language,
    year: yearOf(d.release_date),
    releaseDate: d.release_date || null,
    overview: d.overview,
    tagline: d.tagline,
    runtime: d.runtime,
    genres: d.genres.map((g) => g.name),
    countries: d.production_countries.map((c) => regionNames.of(c.iso_3166_1) ?? c.name),
    directors: d.credits.crew.filter((c) => c.job === 'Director').map((c) => c.name),
    cast: d.credits.cast.sort((a, b) => a.order - b.order).slice(0, 24).map((c) => ({ id: c.id, name: c.name, character: c.character })),
    crew,
    posterUrl: d.poster_path ? `${IMG}/w780${d.poster_path}` : null,
    backdropUrl: backdrop ? `${IMG}/original${backdrop}` : null,
    logoUrl: logo ? `${IMG}/w500${logo}` : null,
  };
}
