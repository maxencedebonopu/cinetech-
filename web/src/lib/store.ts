// Cache partagé de la liste des films : un seul chargement pour toutes les pages.
import { useEffect, useSyncExternalStore } from 'react';
import type { MovieSummary, Settings } from '@cine/shared';
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

// ---------- Réglages : un seul chargement, enregistrement optimiste ----------
type SettingsState = { settings: Settings | null; error: string | null };
let sstate: SettingsState = { settings: null, error: null };
let sloading = false;
const ssubs = new Set<() => void>();
const sset = (s: Partial<SettingsState>) => { sstate = { ...sstate, ...s }; ssubs.forEach((f) => f()); };

export function loadSettings() {
  if (sloading) return;
  sloading = true;
  api.settings().then((settings) => sset({ settings, error: null })).catch((e: Error) => sset({ error: e.message })).finally(() => { sloading = false; });
}

export function useSettings() {
  const s = useSyncExternalStore((f) => { ssubs.add(f); return () => ssubs.delete(f); }, () => sstate);
  useEffect(() => { if (!sstate.settings && !sloading) loadSettings(); }, []);
  return s;
}

/** Applique tout de suite, puis enregistre ; revient en arrière si le serveur refuse. */
export async function saveSettings(patch: Partial<Settings>) {
  const before = sstate.settings;
  if (before) sset({ settings: { ...before, ...patch } });
  try { sset({ settings: await api.putSettings(patch) }); }
  catch (e) { sset({ settings: before }); throw e; }
}
