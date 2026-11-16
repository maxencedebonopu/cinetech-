// Fenêtre modale sur <dialog> natif : piège du focus, Échap et arrière-plan inerte fournis par le navigateur.
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from '@phosphor-icons/react';
import { IconButton } from './controls';

export function Dialog({ open, onClose, title, kicker, children, wide = false }: {
  open: boolean; onClose: () => void; title: ReactNode; kicker?: ReactNode; children: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? ' dialog--wide' : ''}`}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog__body">
        <header className="dialog__head">
          <div>
            {kicker && <span className="t-mono">{kicker}</span>}
            <h2 id="dialog-title" className="dialog__title">{title}</h2>
          </div>
          <IconButton label="Fermer" variant="bare" onClick={onClose}><X /></IconButton>
        </header>
        {children}
      </div>
    </dialog>
  );
}
