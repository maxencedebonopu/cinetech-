// Cache partagé de la liste des films : un seul chargement pour toutes les pages.
import { useEffect, useSyncExternalStore } from 'react';
import type { MovieSummary } from '@cine/shared';
import { api } from './api';

type State = { movies: MovieSummary[] | null; error: string | null; loading: boolean };
let state: State = { movies: null, error: null, loading: false };
const subs = new Set<() => void>();
const set = (s: Partial<State>) => { state = { ...state, ...s }; subs.forEach((f) => f()); };

export function refreshMovies() {
  if (state.loading) return;
  set({ loading: true });
  api.movies()
    .then((movies) => set({ movies, error: null, loading: false }))
    .catch((e: Error) => set({ error: e.message, loading: false }));
}

export function useMovies() {
  const s = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);
  useEffect(() => { if (!state.movies && !state.loading) refreshMovies(); }, []);
  return s;
}

/** Dates SQLite (UTC, « AAAA-MM-JJ HH:MM:SS ») → Date. */
export const sqlDate = (s: string | null) => (s ? new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z')) : null);
