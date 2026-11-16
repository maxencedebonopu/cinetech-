// Images : blurhash, image dimensionnée paresseuse, affiche (avec repli typographique), Ken Burns.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { decode } from 'blurhash';
import type { ImageRef, MovieSummary } from '@cine/shared';
import { imgUrl, srcSet } from '../lib/img';
import { pad, runtime } from '../lib/format';

export function Blurhash({ hash, ratio, className = '' }: { hash: string; ratio: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !hash) return;
    const w = 32, h = Math.max(1, Math.round(32 / ratio));
    c.width = w; c.height = h;
    try {
      const px = decode(hash, w, h);
      const ctx = c.getContext('2d')!;
      const img = ctx.createImageData(w, h);
      img.data.set(px);
      ctx.putImageData(img, 0, 0);
    } catch { /* hash invalide : le fond de surface suffit */ }
  }, [hash, ratio]);
  return <canvas ref={ref} className={`blurhash ${className}`} aria-hidden />;
}

/** Image WebP dimensionnée : blurhash immédiat, chargement paresseux, fondu à l'arrivée. */
export function Img({ image, sizes, alt = '', className = '', eager = false, style }: {
  image: ImageRef; sizes: string; alt?: string; className?: string; eager?: boolean; style?: CSSProperties;
}) {
  const [loaded, setLoaded] = useState(false);
  const ratio = image.width / image.height;
  return (
    <span className={`img ${loaded ? 'is-loaded' : ''} ${className}`} style={style}>
      {image.blurhash && <Blurhash hash={image.blurhash} ratio={ratio} />}
      <img
        src={imgUrl(image, image.widths[Math.min(1, image.widths.length - 1)])}
        srcSet={srcSet(image)}
        sizes={sizes}
        width={image.width}
        height={image.height}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        ref={(el) => { if (el?.complete && el.naturalWidth) setLoaded(true); }}
        onLoad={() => setLoaded(true)}
      />
    </span>
  );
}

/** Le mot le plus long doit tenir sur la largeur (≈ 0,44 em par caractère en Instrument Serif). */
function titleSize(title: string) {
  const words = title.split(/\s+/);
  const longest = Math.max(...words.map((w) => w.length));
  const fit = 80 / (longest * 0.44);
  return `${Math.min(words.length > 4 ? 12 : 15, fit).toFixed(1)}cqi`;
}

type PosterMovie = Pick<MovieSummary, 'id' | 'title' | 'year' | 'poster' | 'still' | 'palette' | 'progress' | 'watched' | 'directors' | 'runtime'>;

/**
 * Affiche 2:3. Sans affiche TMDB : affiche typographique composée sur le photogramme du film,
 * avec un passe-partout à la couleur du film.
 */
export function Poster({ movie, sizes = '(max-width: 600px) 45vw, 220px', caption = true, number, href, onClick, focusable = true, eager }: {
  movie: PosterMovie; sizes?: string; caption?: boolean; number?: number; href?: string;
  onClick?: () => void; focusable?: boolean; eager?: boolean;
}) {
  const accent = movie.palette?.accent;
  const style = accent ? ({ ['--film-accent' as string]: accent } as CSSProperties) : undefined;
  const body = (
    <>
      <span className="poster__frame">
        {movie.poster ? (
          <Img image={movie.poster} sizes={sizes} eager={eager} />
        ) : (
          <span className="poster__fallback">
            {movie.still && <Img image={movie.still} sizes={sizes} className="poster__still" eager={eager} />}
            <span className="poster__mat" aria-hidden />
            <span className="poster__type">
              <span className="t-mono poster__no">{number != null ? `N° ${pad(number, 3)}` : movie.year}</span>
              <span className="poster__ftitle" style={{ ['--pt' as string]: titleSize(movie.title) }}>{movie.title}</span>
              {movie.directors[0] && <span className="poster__by">{movie.directors[0]}</span>}
            </span>
          </span>
        )}
        {movie.progress > 0 && !movie.watched && (
          <span className="poster__progress" aria-label={`Vu à ${Math.round(movie.progress * 100)} %`}>
            <i style={{ transform: `scaleX(${movie.progress})` }} />
          </span>
        )}
        {movie.watched && <span className="poster__seen t-mono">Vu</span>}
      </span>
      {caption && (
        <span className="poster__caption">
          <span className="poster__title">{movie.title}</span>
          <span className="t-mono poster__meta">
            {[movie.year, runtime(movie.runtime)].filter(Boolean).join(' · ')}
          </span>
        </span>
      )}
    </>
  );
  const cls = 'poster';
  if (href) return <a className={cls} href={href} style={style} tabIndex={focusable ? 0 : -1}>{body}</a>;
  return <button type="button" className={cls} style={style} onClick={onClick} tabIndex={focusable ? 0 : -1}>{body}</button>;
}

/** Lent travelling sur une image fixe (désactivé si mouvement réduit). */
export function KenBurns({ image, sizes = '100vw', origin = 'center', children, className = '' }: {
  image: ImageRef; sizes?: string; origin?: string; children?: ReactNode; className?: string;
}) {
  return (
    <div className={`kenburns ${className}`}>
      <Img image={image} sizes={sizes} className="kenburns__img" eager style={{ transformOrigin: origin }} />
      {children}
    </div>
  );
}
