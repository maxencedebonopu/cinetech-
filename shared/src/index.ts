// Types partagés entre le serveur et l'interface.

export type MatchStatus = 'pending' | 'matched' | 'review' | 'unmatched' | 'manual';

export interface Person {
  id: number;
  name: string;
  job?: string;        // pour l'équipe : Director, Screenplay, Director of Photography…
  character?: string;  // pour le casting
}

export interface Palette {
  vibrant?: string;
  darkVibrant?: string;
  lightVibrant?: string;
  muted?: string;
  darkMuted?: string;
  lightMuted?: string;
  /** Couleur d'accent retenue, contrastée sur fond noir chaud. */
  accent: string;
}

export interface ImageRef {
  /** Nom de base ; l'URL est /images/{base}-{largeur}.webp */
  base: string;
  widths: number[];
  width: number;
  height: number;
  blurhash: string;
}

export interface AudioTrack {
  index: number;
  codec: string;
  language: string | null;
  channels: number;
  layout: string | null;
  title: string | null;
  default: boolean;
}

export interface Chapter {
  start: number;
  end: number;
  title: string | null;
}

export interface MediaInfo {
  container: string;
  duration: number;       // secondes
  size: number;           // octets
  bitrate: number;        // bits/s
  video: {
    index: number;
    codec: string;
    profile: string | null;
    width: number;
    height: number;
    fps: number | null;
    bitDepth: number | null;
    hdr: 'SDR' | 'HDR10' | 'HLG' | 'DV';
    aspect: string | null;
  } | null;
  audio: AudioTrack[];
  chapters: Chapter[];
}

export type SubtitleSource = 'external' | 'embedded';

export interface SubtitleTrack {
  id: number;
  source: SubtitleSource;
  language: string | null;
  forced: boolean;
  label: string;
  codec: string;
  /** false pour les sous-titres image (PGS, VobSub) : seulement incrustables. */
  textBased: boolean;
  url: string | null;     // URL WebVTT si textBased
}

export interface MovieSummary {
  id: number;
  title: string;
  originalTitle: string | null;
  year: number | null;
  runtime: number | null;  // minutes
  genres: string[];
  directors: string[];
  countries: string[];
  poster: ImageRef | null;
  backdrop: ImageRef | null;
  logo: ImageRef | null;
  /** Photogramme extrait du film : fond de repli quand TMDB n'en fournit pas. */
  still: ImageRef | null;
  palette: Palette | null;
  matchStatus: MatchStatus;
  addedAt: string;
  watched: boolean;
  progress: number;        // 0..1
  /** Dernière séance (lancement), ISO ; null si jamais projeté. */
  lastPlayedAt: string | null;
  subtitleLanguages: string[];
}

export interface MovieDetail extends MovieSummary {
  tmdbId: number | null;
  overview: string | null;
  tagline: string | null;
  originalLanguage: string | null;
  cast: Person[];
  crew: Person[];
  filePath: string;
  fileName: string;
  media: MediaInfo | null;
  subtitles: SubtitleTrack[];
  user: UserData;
}

export interface UserData {
  rating: number | null;
  watchCount: number;
  lastWatchedAt: string | null;
  position: number;        // secondes
  watched: boolean;
  subtitleOffset: number;  // secondes
}

export interface OrphanSubtitle {
  id: number;
  path: string;
  fileName: string;
  language: string | null;
  guessTitle: string | null;
  guessYear: number | null;
}

export interface TmdbSearchResult {
  tmdbId: number;
  title: string;
  originalTitle: string;
  year: number | null;
  overview: string;
  posterUrl: string | null;
}

export interface LibraryStatus {
  scanning: boolean;
  phase: string;
  done: number;
  total: number;
  lastScanAt: string | null;
  movies: number;
  needsReview: number;
  orphanSubtitles: number;
}

export interface Health {
  ffmpeg: string | null;
  ffprobe: string | null;
  tmdb: boolean;
  hwaccel: string[];
  version: string;
}

// ---------- Lecture ----------

/** Ce que le navigateur sait décoder (mesuré côté client avec MediaSource.isTypeSupported). */
export interface ClientCaps {
  mse: boolean;          // Media Source Extensions (hls.js)
  nativeHls: boolean;    // Safari / iOS
  video: { h264: boolean; hevc: boolean; av1: boolean; vp9: boolean };
  audio: { aac: boolean; ac3: boolean; eac3: boolean; opus: boolean; flac: boolean; mp3: boolean };
  hdr: boolean;          // écran HDR (matchMedia dynamic-range: high)
  maxAudioChannels: number;
}

export type Quality = 'original' | '8M' | '4M';
export type PlaybackMode = 'direct' | 'remux' | 'transcode';

export interface PlaybackRequest {
  movieId: number;
  start: number;              // secondes
  audioIndex?: number | null; // index ffprobe de la piste audio
  burnSubtitleId?: number | null; // sous-titre image à incruster
  quality: Quality;
  caps: ClientCaps;
  replaceSessionId?: string | null;
}

export interface PlaybackPlan {
  sessionId: string;
  mode: PlaybackMode;
  url: string;
  /** Position réelle (s) à laquelle commence le flux ; temps du film = offset + video.currentTime */
  offset: number;
  duration: number;
  reasons: string[];
  video: string;              // ex. « hevc → copie », « h264 (AMF) »
  audio: string;              // ex. « dts 5.1 → aac 5.1 »
  encoder: string | null;
}

export interface PlaybackPing {
  sessionId: string;
  position: number;           // temps du film (s)
  paused: boolean;
}

export interface PingResponse {
  /** Plage du film disponible sans relancer le flux (temps du film). */
  availableFrom: number;
  availableTo: number;
  finished: boolean;
  watched: boolean;
}

export interface TrickplayInfo {
  interval: number;           // secondes entre deux vignettes
  width: number;
  height: number;
  columns: number;
  rows: number;
  count: number;
  sheets: string[];           // URLs des planches
}

export interface Settings {
  libraryDirs: string[];
  tmdbLanguage: string;
  preferredAudioLanguage: string;
  preferredSubtitleLanguage: string;
  remoteQuality: 'original' | '8M' | '4M';
  grain: boolean;
  leader: boolean;
}

// ----- Statistiques -----
export interface Count { label: string; count: number }

export interface ViewingStats {
  seconds: number;
  sessions: number;
  films: number;              // films distincts projetés
  days: number;               // jours avec au moins une séance
  longestStreak: number;      // jours consécutifs
  /** Minutes par jour (date locale AAAA-MM-JJ) sur la période. */
  daily: Record<string, number>;
  /** Secondes par heure de début (0..23) et par jour (0 = lundi). */
  byHour: number[];
  byWeekday: number[];
  top: { movieId: number; sessions: number; seconds: number }[];
  decades: Count[];           // secondes par décennie des films vus
  genres: Count[];
  directors: Count[];
  journal: { movieId: number; startedAt: string; seconds: number }[];
}

export interface CollectionStats {
  films: number;
  matched: number;
  watched: number;
  sizeBytes: number;
  durationSeconds: number;
  decades: { label: string; count: number; watched: number }[];
  resolution: Count[];
  dynamicRange: Count[];
  videoCodecs: Count[];
  audio: Count[];             // stéréo, 5.1, 7.1…
  subtitles: Count[];         // films par langue de sous-titres
  withoutSubtitles: number;
  genres: Count[];
  countries: Count[];
  records: { label: string; movieId: number; value: string }[];
}

export interface Stats {
  /** Années ayant au moins une séance, la plus récente d'abord. */
  years: number[];
  year: number | null;        // null = depuis le début
  viewing: ViewingStats;
  collection: CollectionStats;
  ratings: number[];          // nombre de films par note 1..5 (index 0 = 1 étoile)
}
