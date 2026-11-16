// Source de secours, sans clé : Wikidata (identification, générique, durée, pays) et Wikipédia
// (affiche, synopsis). Utilisée tant qu'aucune clé TMDB n'est enregistrée ; TMDB la remplace ensuite.
// Les API Wikimedia limitent le débit : une requête à la fois, espacées, avec reprise sur 429.
import type { Person } from '@cine/shared';
import type { MovieMetadata } from './tmdb.ts';
import { similarity } from '../library/parse.ts';

// Wikimédia limite à 10 requêtes/min un client sans contact, 200/min avec un contact dans l'en-tête
// User-Agent (e-mail ou URL). Le contact est facultatif : WIKI_CONTACT dans .env.
const CONTACT = (process.env.WIKI_CONTACT ?? '').trim();
const HEADERS = { 'user-agent': `Cinematheque/0.1 (serveur multimedia personnel${CONTACT ? `; ${CONTACT}` : ''}) Node.js`, accept: 'application/json' };
const GAP = CONTACT ? 400 : 6500;

let queue: Promise<unknown> = Promise.resolve();
let last = 0;
/** Requête Wikimédia, sérialisée et espacée ; respecte Retry-After et reprend quand le débit est dépassé. */
function queued<T>(url: string, read: (res: Response) => Promise<T>): Promise<T> {
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      const wait = last + GAP - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      const res = await fetch(url, { headers: HEADERS });
      if (res.ok) return read(res);
      if ((res.status !== 429 && res.status < 500) || attempt >= 4) throw new Error(`Wikimedia ${res.status} : ${url.slice(0, 90)}`);
      const after = Number(res.headers.get('retry-after'));
      await new Promise((r) => setTimeout(r, (after > 0 ? after : 30 * (attempt + 1)) * 1000));
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}
function api<T>(host: string, params: Record<string, string>): Promise<T> {
  const url = `https://${host}/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  return queued(url, async (res) => JSON.parse(await res.text()) as T);
}
/** Image d'upload.wikimedia.org, dans la même file (même politique de débit). */
export function wikiImage(url: string): Promise<Buffer> {
  return queued(url, async (res) => Buffer.from(await res.arrayBuffer()));
}

// ---------- Wikidata ----------

interface Snak { datavalue?: { value: any } }
interface Claim { mainsnak: Snak; rank?: string; qualifiers?: Record<string, Snak[]> }
interface Entity {
  id: string;
  labels?: Record<string, { value: string }>;
  claims?: Record<string, Claim[]>;
  sitelinks?: Record<string, { title: string }>;
}

const wd = (params: Record<string, string>) => api<any>('www.wikidata.org', params);
async function entities(ids: string[], props: string): Promise<Record<string, Entity>> {
  const out: Record<string, Entity> = {};
  for (let i = 0; i < ids.length; i += 50) {
    const r = await wd({ action: 'wbgetentities', ids: ids.slice(i, i + 50).join('|'), props, languages: 'fr|en', sitefilter: 'frwiki|enwiki' });
    Object.assign(out, r.entities ?? {});
  }
  return out;
}
const claims = (e: Entity, p: string) => (e.claims?.[p] ?? []).filter((c) => c.rank !== 'deprecated');
const ids = (e: Entity, p: string) => claims(e, p).map((c) => c.mainsnak.datavalue?.value?.id as string | undefined).filter((x): x is string => !!x);
const years = (e: Entity) => claims(e, 'P577').map((c) => Number(String(c.mainsnak.datavalue?.value?.time ?? '').slice(1, 5))).filter(Boolean);
const label = (e: Entity | undefined) => e?.labels?.fr?.value ?? e?.labels?.en?.value ?? null;

/** Cherche le film sur Wikidata : œuvre avec un réalisateur (P57), année de sortie à ±1 an. */
const found = new Map<string, Entity>(); // entités lues pendant la recherche, réutilisées pour la fiche

/** Titres connus d'une entité : libellés fr / en, titre original, articles Wikipédia. */
function titlesOf(e: Entity): string[] {
  return [e.labels?.fr?.value, e.labels?.en?.value, claims(e, 'P1476')[0]?.mainsnak.datavalue?.value?.text,
    e.sitelinks?.frwiki?.title, e.sitelinks?.enwiki?.title].filter((t): t is string => !!t).map(stripQualifier);
}

/** Cherche le film sur Wikidata (œuvre avec un réalisateur, P57). Choix : titre le plus proche,
 *  année exacte avant ±1 an. Deuxième essai avec l'année pour les titres très courants (« The Thing »). */
export async function wikiFind(title: string, year: number | null): Promise<string | null> {
  for (const query of year == null ? [title] : [title, `${title} ${year}`]) {
    const r = await wd({ action: 'query', list: 'search', srsearch: `${query} haswbstatement:P57`, srlimit: '10' });
    const hits: string[] = (r.query?.search ?? []).map((s: { title: string }) => s.title);
    if (!hits.length) continue;
    const ents = await entities(hits, 'labels|claims|sitelinks');
    let best: { id: string; score: number } | null = null;
    hits.forEach((id, rank) => {
      const e = ents[id];
      if (!e) return;
      const sim = Math.max(0, ...titlesOf(e).map((t) => similarity(t, title)));
      const ys = years(e);
      const yearScore = year == null ? 0.5 : ys.includes(year) ? 1 : ys.some((y) => Math.abs(y - year) <= 1) ? 0.6 : -1;
      if (yearScore < 0 || sim < 0.5) return;
      const score = sim * 2 + yearScore - rank * 0.02;
      if (!best || score > best.score) best = { id, score };
    });
    const pick = best as { id: string; score: number } | null;
    if (pick) { found.set(pick.id, ents[pick.id]); return pick.id; }
  }
  return null;
}

// ---------- Genres : « film de science-fiction » → « Science-fiction » ----------

const GENRE_WORDS: Record<string, string> = {
  dramatique: 'Drame', policier: 'Policier', fantastique: "Fantastique", historique: 'Historique', biographique: 'Biopic',
  romantique: 'Romance', musical: 'Musical', comique: 'Comédie', "d'animation": 'Animation', 'de guerre': 'Guerre',
  "d'horreur": 'Horreur', "d'aventure": 'Aventure', "d'action": 'Action', 'de science-fiction': 'Science-fiction',
  'à suspense': 'Thriller', 'de gangsters': 'Gangsters', 'de mystère': 'Mystère', 'catastrophe': 'Catastrophe',
};
function genreName(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!/^(films?|cinéma|téléfilms?)\s/.test(s)) return raw.charAt(0).toUpperCase() + raw.slice(1);
  // « film et téléfilm de fantasy », « cinéma de science-fiction », « film ou téléfilm de sport »
  const rest = s.replace(/^(films?|cinéma|téléfilms?)\s+((et|ou)\s+téléfilms?\s+)?/, '');
  if (GENRE_WORDS[rest]) return GENRE_WORDS[rest];
  if (/^(basé|adapté|tiré|d'après|indépendant|en noir|muet|de série|réalisé)/.test(rest)) return null;
  const clean = rest.replace(/^(de |d'|du |des )/, '');
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : null;
}

// ---------- Wikipédia ----------

const stripQualifier = (t: string) => t.replace(/\s*\((?:film|téléfilm)[^)]*\)$/i, '').replace(/\s*\(\d{4} film\)$/i, '').replace(/\s*\(film\)$/i, '');

async function extract(lang: 'fr' | 'en', page: string): Promise<string> {
  const r = await api<any>(`${lang}.wikipedia.org`, { action: 'query', prop: 'extracts', explaintext: '1', redirects: '1', titles: page });
  return r.query?.pages?.[0]?.extract ?? '';
}
/** Premier ou deux premiers paragraphes, coupés à une fin de phrase autour de `max` caractères. */
function trimText(text: string, max = 900): string {
  const paras = text.split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 40 && !p.startsWith('=='));
  let out = '';
  for (const p of paras) {
    if (out && out.length + p.length > max) break;
    out = out ? `${out}\n\n${p}` : p;
    if (out.length > max * 0.6) break;
  }
  if (out.length > max * 1.3) {
    const cut = out.slice(0, max);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
    out = end > max * 0.4 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
  }
  return out;
}
function section(text: string, names: string[]): string | null {
  const re = new RegExp(`^==\\s*(?:${names.join('|')})\\s*==[ \\t]*\\n([\\s\\S]*?)(?=\\n==[^=]|(?![\\s\\S]))`, 'im');
  const m = re.exec(text);
  return m ? m[1].replace(/^===.*===$/gm, '').trim() : null;
}

async function synopsis(frPage: string | undefined, enPage: string | undefined): Promise<string> {
  if (frPage) {
    const fr = await extract('fr', frPage);
    const s = section(fr, ['Synopsis', 'Résumé', 'Intrigue', 'Histoire', 'Scénario', 'Résumé détaillé']);
    if (s) return trimText(s);
    // pas de synopsis rédigé : l'introduction de l'article, faute de mieux en anglais plus bas
    if (!enPage) return trimText(fr.split(/\n==/)[0]);
  }
  if (enPage) {
    const en = await extract('en', enPage);
    const s = section(en, ['Plot', 'Synopsis', 'Premise', 'Plot summary']);
    if (s) return trimText(s);
    if (frPage) return trimText((await extract('fr', frPage)).split(/\n==/)[0]);
    return trimText(en.split(/\n==/)[0]);
  }
  return '';
}

/** Affiche : propriété « affiche du film » (P3383) sur Commons, sinon l'image d'infobox de Wikipédia anglais. */
async function posterUrl(e: Entity, enPage: string | undefined): Promise<string | null> {
  const file = claims(e, 'P3383')[0]?.mainsnak.datavalue?.value as string | undefined;
  if (file) return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=780`;
  if (!enPage) return null;
  // Les affiches ne sont pas libres : l'API « pageimages » les ignore. On lit le champ image de l'infobox.
  const r = await api<any>('en.wikipedia.org', { action: 'parse', page: enPage, prop: 'wikitext', section: '0', redirects: '1' });
  const wikitext: string = r.parse?.wikitext ?? '';
  const name = /\|\s*image\s*=\s*(?:\[\[)?(?:File:|Image:)?([^\n|\]]+\.(?:jpe?g|png|webp|gif))/i.exec(wikitext)?.[1]?.trim();
  if (!name) return null;
  const info = await api<any>('en.wikipedia.org', { action: 'query', prop: 'imageinfo', iiprop: 'url', iiurlwidth: '780', titles: `File:${name}` });
  const ii = info.query?.pages?.[0]?.imageinfo?.[0];
  return ii?.thumburl ?? ii?.url ?? null;
}

// ---------- Fiche ----------

/** Langue originale (P364) → code ISO 639-1, pour les langues courantes. */
const LANGS: Record<string, string> = {
  Q1860: 'en', Q150: 'fr', Q5287: 'ja', Q1321: 'es', Q652: 'it', Q188: 'de', Q9176: 'ko', Q7850: 'zh', Q727694: 'zh', Q9186: 'zh',
  Q5146: 'pt', Q7737: 'ru', Q9027: 'sv', Q9035: 'da', Q9043: 'no', Q7411: 'nl', Q1412: 'fi', Q809: 'pl', Q256: 'tr', Q9168: 'fa',
  Q13955: 'ar', Q1568: 'hi', Q9217: 'th', Q8641: 'zh', Q9288: 'he', Q9067: 'hu', Q9056: 'cs', Q36510: 'el', Q7913: 'ro', Q8798: 'uk',
};

const CREW: [string, string][] = [['P57', 'Director'], ['P58', 'Screenplay'], ['P344', 'Director of Photography'], ['P86', 'Original Music Composer'], ['P1040', 'Editor'], ['P162', 'Producer']];
const num = (qid: string) => Number(qid.slice(1));

export async function wikiMovie(qid: string): Promise<MovieMetadata & { wikidataId: string }> {
  const e = found.get(qid) ?? (await entities([qid], 'labels|claims|sitelinks'))[qid];
  found.delete(qid);
  if (!e) throw new Error(`Wikidata : ${qid} introuvable`);
  const frPage = e.sitelinks?.frwiki?.title;
  const enPage = e.sitelinks?.enwiki?.title;

  const castIds = ids(e, 'P161').slice(0, 14);
  const crewIds = CREW.flatMap(([p]) => ids(e, p).slice(0, 3));
  const genreIds = ids(e, 'P136').slice(0, 6);
  const countryIds = ids(e, 'P495').slice(0, 3);
  const langIds = ids(e, 'P364').slice(0, 1);
  const refs = await entities([...new Set([...castIds, ...crewIds, ...genreIds, ...countryIds])], 'labels');

  // Date : la plus ancienne, avec le jour quand la précision le permet
  let releaseDate: string | null = null, year: number | null = null;
  for (const c of claims(e, 'P577')) {
    const v = c.mainsnak.datavalue?.value;
    if (!v?.time) continue;
    const y = Number(String(v.time).slice(1, 5));
    if (year == null || y < year) {
      year = y;
      releaseDate = v.precision >= 11 ? String(v.time).slice(1, 11) : null;
    }
  }
  const dur = claims(e, 'P2047')[0]?.mainsnak.datavalue?.value;
  const runtime = dur ? Math.round(Math.abs(Number(dur.amount)) / (String(dur.unit).endsWith('Q11574') ? 60 : 1)) : null;

  const crew: Person[] = [];
  for (const [p, job] of CREW) for (const id of ids(e, p).slice(0, 3)) {
    const n = label(refs[id]);
    if (n) crew.push({ id: num(id), name: n, job });
  }
  const cast: Person[] = castIds.map((id) => ({ id: num(id), name: label(refs[id]) ?? '' })).filter((p) => p.name);
  // genres : libellé français seulement (sinon « Teen drama film » se glisse parmi les genres)
  const genres = [...new Set(genreIds.map((id) => refs[id]?.labels?.fr?.value).filter((x): x is string => !!x).map(genreName).filter((x): x is string => !!x))].slice(0, 3);
  const countries = countryIds.map((id) => label(refs[id])).filter((x): x is string => !!x);
  const langCode = langIds.length ? LANGS[langIds[0]] : undefined;

  const title = frPage ? stripQualifier(frPage) : label(e) ?? qid;
  const originalTitle = (claims(e, 'P1476')[0]?.mainsnak.datavalue?.value?.text as string | undefined) ?? e.labels?.en?.value ?? title;

  return {
    tmdbId: 0,
    wikidataId: qid,
    title,
    originalTitle,
    originalLanguage: langCode ?? '',
    year,
    releaseDate,
    overview: await synopsis(frPage, enPage),
    tagline: '',
    runtime,
    genres,
    countries,
    directors: crew.filter((c) => c.job === 'Director').map((c) => c.name),
    cast,
    crew,
    posterUrl: await posterUrl(e, enPage),
    backdropUrl: null,
    logoUrl: null,
  };
}
