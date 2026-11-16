import type { AuthState, MovieSummary, MovieDetail, TrickplayInfo, UserData, TmdbSearchResult, Health, Settings, Stats, TmdbKeyInfo, LibraryStatus, OrphanSubtitle } from '@cine/shared';

export class ApiError extends Error {
  constructor(public status: number, public path: string, message: string) { super(message); }
}

/** Erreur de l'API ; un 401 « auth » (séance fermée, mot de passe changé) ramène à la page de connexion. */
async function failure(res: Response, path: string) {
  const body = await res.json().catch(() => null);
  if (res.status === 401 && body?.auth) window.dispatchEvent(new Event('cine:auth'));
  return new ApiError(res.status, path, body?.error ?? res.statusText);
}

export async function get<T>(path: string): Promise<T> {
  let res: Response;
  try { res = await fetch(path); }
  catch { throw new ApiError(0, path, 'Serveur injoignable'); }
  if (!res.ok) throw await failure(res, path);
  return res.json() as Promise<T>;
}

async function send<T>(method: string, path: string, body: unknown): Promise<T> {
  let res: Response;
  try { res = await fetch(path, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new ApiError(0, path, 'Serveur injoignable'); }
  if (!res.ok) throw await failure(res, path);
  return res.json() as Promise<T>;
}

export const api = {
  auth: () => get<AuthState>('/api/auth'),
  login: (motDePasse: string) => send<{ ok: boolean }>('POST', '/api/auth/connexion', { motDePasse }),
  logout: () => send<{ ok: boolean }>('POST', '/api/auth/deconnexion', {}),
  setPassword: (nouveau: string, actuel?: string) => send<{ ok: boolean }>('PUT', '/api/auth/mot-de-passe', { nouveau, actuel }),
  removePassword: () => send<{ ok: boolean }>('DELETE', '/api/auth/mot-de-passe', undefined),
  closeSessions: () => send<{ ok: boolean; sessions: number }>('POST', '/api/auth/fermer-seances', {}),
  health: () => get<Health>('/api/health'),
  settings: () => get<Settings>('/api/settings'),
  putSettings: (patch: Partial<Settings>) => send<Settings>('PUT', '/api/settings', patch),
  tmdbKey: () => get<TmdbKeyInfo>('/api/tmdb/key'),
  setTmdbKey: (key: string) => send<TmdbKeyInfo>('PUT', '/api/tmdb/key', { key }),
  removeTmdbKey: () => send<TmdbKeyInfo>('DELETE', '/api/tmdb/key', undefined),
  checkDir: (path: string) => send<{ ok: boolean }>('POST', '/api/library/check-dir', { path }),
  status: () => get<LibraryStatus>('/api/library/status'),
  scan: () => send<LibraryStatus>('POST', '/api/library/scan', {}),
  orphans: () => get<OrphanSubtitle[]>('/api/subtitles/orphans'),
  assignSubtitle: (id: number, movieId: number | null) => send<{ ok: boolean }>('POST', `/api/subtitles/${id}/assign`, { movieId }),
  patchSubtitleOffset: (id: number, subtitleOffset: number) => send<UserData>('PATCH', `/api/movies/${id}/user`, { subtitleOffset }),
  patchUser: (id: number, patch: Partial<{ rating: number | null; watched: boolean; position: number }>) => send<UserData>('PATCH', `/api/movies/${id}/user`, patch),
  tmdbSearch: (q: string, year?: number | null) => get<TmdbSearchResult[]>(`/api/tmdb/search?q=${encodeURIComponent(q)}${year ? `&year=${year}` : ''}`),
  match: (id: number, tmdbId: number) => send<MovieDetail>('POST', `/api/movies/${id}/match`, { tmdbId }),
  movies: () => get<MovieSummary[]>('/api/movies'),
  movie: (id: number) => get<MovieDetail>(`/api/movies/${id}`),
  trickplay: (id: number) => get<TrickplayInfo>(`/api/movies/${id}/trickplay`),
  stats: (year?: string | null) => get<Stats>(`/api/stats${year ? `?annee=${encodeURIComponent(year)}` : ''}`),
};
