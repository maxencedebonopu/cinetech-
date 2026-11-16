import Database from 'better-sqlite3';
import { paths, config } from './config.ts';

export const db = new Database(paths.db);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

const MIGRATIONS: string[] = [
  /* 1 */ `
  CREATE TABLE movies (
    id INTEGER PRIMARY KEY,
    file_path TEXT NOT NULL UNIQUE,
    file_size INTEGER NOT NULL,
    file_mtime INTEGER NOT NULL,
    parsed_title TEXT NOT NULL,
    parsed_year INTEGER,
    parsed_edition TEXT,
    match_status TEXT NOT NULL DEFAULT 'pending',
    match_score REAL,
    tmdb_id INTEGER,
    title TEXT,
    original_title TEXT,
    year INTEGER,
    release_date TEXT,
    overview TEXT,
    tagline TEXT,
    runtime INTEGER,
    original_language TEXT,
    genres TEXT NOT NULL DEFAULT '[]',
    countries TEXT NOT NULL DEFAULT '[]',
    directors TEXT NOT NULL DEFAULT '[]',
    cast_json TEXT NOT NULL DEFAULT '[]',
    crew_json TEXT NOT NULL DEFAULT '[]',
    poster TEXT,
    backdrop TEXT,
    logo TEXT,
    palette TEXT,
    media TEXT,
    probed_mtime INTEGER,
    missing INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_movies_tmdb ON movies(tmdb_id);

  CREATE TABLE subtitles (
    id INTEGER PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,           -- chemin du .srt, ou "emb:{movieId}:{streamIndex}"
    source TEXT NOT NULL,               -- external | embedded
    path TEXT,                          -- fichier externe
    movie_id INTEGER REFERENCES movies(id) ON DELETE SET NULL,
    stream_index INTEGER,
    codec TEXT NOT NULL,
    text_based INTEGER NOT NULL DEFAULT 1,
    language TEXT,
    language_source TEXT,               -- filename | content | stream | manual
    forced INTEGER NOT NULL DEFAULT 0,
    sdh INTEGER NOT NULL DEFAULT 0,
    title TEXT,
    encoding TEXT,
    guess_title TEXT,
    guess_year INTEGER,
    match_method TEXT,                  -- basename | title | fuzzy | manual
    match_score REAL,
    file_mtime INTEGER
  );
  CREATE INDEX idx_subs_movie ON subtitles(movie_id);

  CREATE TABLE user_data (
    movie_id INTEGER PRIMARY KEY REFERENCES movies(id) ON DELETE CASCADE,
    rating REAL,
    watch_count INTEGER NOT NULL DEFAULT 0,
    last_watched_at TEXT,
    position REAL NOT NULL DEFAULT 0,
    watched INTEGER NOT NULL DEFAULT 0,
    subtitle_offset REAL NOT NULL DEFAULT 0,
    prefs TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE plays (
    id INTEGER PRIMARY KEY,
    movie_id INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    seconds REAL NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_plays_movie ON plays(movie_id);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // 2 — photogramme de repli (films sans fond TMDB) et sa palette
  `
  ALTER TABLE movies ADD COLUMN still TEXT;
  ALTER TABLE movies ADD COLUMN still_palette TEXT;
  `,
  // 3 — séances ouvertes à distance (jeton haché, jamais le jeton lui-même)
  `
  CREATE TABLE auth_sessions (
    token_hash TEXT PRIMARY KEY,
    created INTEGER NOT NULL,
    seen INTEGER NOT NULL,
    agent TEXT
  );
  `,
];

function migrate() {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
migrate();

// ---------- Réglages ----------

const DEFAULT_SETTINGS = {
  libraryDirs: config.initialLibraryDirs,
  tmdbLanguage: config.tmdbLanguage,
  preferredAudioLanguage: 'original', // 'original' = piste par défaut du fichier (VO)
  preferredSubtitleLanguage: 'fr',    // code langue, ou 'none'
  remoteQuality: 'original',
  grain: true,
  leader: true,
} as const;

export type SettingsShape = { -readonly [K in keyof typeof DEFAULT_SETTINGS]: (typeof DEFAULT_SETTINGS)[K] extends readonly string[] ? string[] : (typeof DEFAULT_SETTINGS)[K] extends boolean ? boolean : string };

export function getSettings(): SettingsShape {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  // seules les clés connues sortent : la clé TMDB et le mot de passe vivent aussi dans cette table
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = JSON.parse(r.value);
  return out as SettingsShape;
}

export function updateSettings(patch: Partial<SettingsShape>) {
  const stmt = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (k in DEFAULT_SETTINGS && v !== undefined) stmt.run(k, JSON.stringify(v));
    }
  })();
  return getSettings();
}

export const json = {
  parse<T>(s: string | null | undefined, fallback: T): T {
    if (!s) return fallback;
    try { return JSON.parse(s) as T; } catch { return fallback; }
  },
};
