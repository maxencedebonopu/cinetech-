// Grille virtualisée sur le défilement de la fenêtre : seules les rangées proches de l'écran existent dans le DOM.
// Hauteur de rangée calculée (largeur de colonne × ratio + légende), donc aucune mesure après rendu.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export function VirtualGrid<T>({ items, minCol, gap: gapProp, ratio, extra, render, overscan = 3, keyOf, className = '' }: {
  items: T[];
  minCol: number | ((width: number) => number);  // largeur mini d'une colonne (px)
  gap: number | ((width: number) => number);     // gouttière (px)
  ratio: number;        // hauteur / largeur de l'image
  extra: number;        // hauteur fixe sous l'image (légende, px)
  render: (item: T, index: number) => ReactNode;
  keyOf: (item: T) => string | number;
  overscan?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 8]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const gap = typeof gapProp === 'function' ? gapProp(width) : gapProp;
  const min = typeof minCol === 'function' ? minCol(width) : minCol;
  const cols = Math.max(1, Math.floor((width + gap) / (min + gap)));
  const colW = width ? (width - gap * (cols - 1)) / cols : min;
  const rowH = Math.round(colW * ratio + extra);
  const rows = Math.ceil(items.length / cols);

  useEffect(() => {
    const update = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;          // position de la grille dans la fenêtre
      const first = Math.floor(Math.max(0, -top) / (rowH + gap));
      const visible = Math.ceil(window.innerHeight / (rowH + gap)) + 1;
      const start = Math.max(0, first - overscan);
      const end = Math.min(rows, first + visible + overscan);
      setRange((r) => (r[0] === start && r[1] === end ? r : [start, end]));
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [rowH, gap, rows, overscan]);

  const [start, end] = range;
  const slice = items.slice(start * cols, end * cols);
  return (
    <div ref={ref} className={`vgrid ${className}`} style={{ height: rows ? rows * rowH + (rows - 1) * gap : 0, position: 'relative' }}>
      <div
        className="vgrid__inner"
        style={{
          position: 'absolute', left: 0, right: 0, top: start * (rowH + gap),
          display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: rowH, gap,
        }}
      >
        {slice.map((it, i) => <div key={keyOf(it)} className="vgrid__cell">{render(it, start * cols + i)}</div>)}
      </div>
    </div>
  );
}
