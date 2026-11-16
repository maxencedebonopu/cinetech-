import type { MovieSummary, MovieDetail, TrickplayInfo } from '@cine/shared';

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

export const api = {
  movies: () => get<MovieSummary[]>('/api/movies'),
  movie: (id: number) => get<MovieDetail>(`/api/movies/${id}`),
  trickplay: (id: number) => get<TrickplayInfo>(`/api/movies/${id}/trickplay`),
};
