import type { MovieSummary, MovieDetail, TrickplayInfo, UserData, TmdbSearchResult, Health } from '@cine/shared';

export class ApiError extends Error {
  constructor(public status: number, public path: string, message: string) { super(message); }
}

export async function get<T>(path: string): Promise<T> {
  let res: Response;
  try { res = await fetch(path); }
  catch { throw new ApiError(0, path, 'Serveur injoignable'); }
  if (!res.ok) throw new ApiError(res.status, path, (await res.json().catch(() => null))?.error ?? res.statusText);
  return res.json() as Promise<T>;
}

async function send<T>(method: string, path: string, body: unknown): Promise<T> {
  let res: Response;
  try { res = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new ApiError(0, path, 'Serveur injoignable'); }
  if (!res.ok) throw new ApiError(res.status, path, (await res.json().catch(() => null))?.error ?? res.statusText);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => get<Health>('/api/health'),
  patchUser: (id: number, patch: Partial<{ rating: number | null; watched: boolean; position: number }>) => send<UserData>('PATCH', `/api/movies/${id}/user`, patch),
  tmdbSearch: (q: string, year?: number | null) => get<TmdbSearchResult[]>(`/api/tmdb/search?q=${encodeURIComponent(q)}${year ? `&year=${year}` : ''}`),
  match: (id: number, tmdbId: number) => send<MovieDetail>('POST', `/api/movies/${id}/match`, { tmdbId }),
  movies: () => get<MovieSummary[]>('/api/movies'),
  movie: (id: number) => get<MovieDetail>(`/api/movies/${id}`),
  trickplay: (id: number) => get<TrickplayInfo>(`/api/movies/${id}/trickplay`),
};
