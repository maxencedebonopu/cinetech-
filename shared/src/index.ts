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
  palette: Palette | null;
  matchStatus: MatchStatus;
  addedAt: string;
  watched: boolean;
  progress: number;        // 0..1
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

export interface Settings {
  libraryDirs: string[];
  tmdbLanguage: string;
  preferredAudioLanguage: string;
  preferredSubtitleLanguage: string;
  remoteQuality: 'original' | '8M' | '4M';
  grain: boolean;
  leader: boolean;
}
