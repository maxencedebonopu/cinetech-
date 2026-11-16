// « Séance privée » : page de connexion de l'accès distant (Tailscale, réseau local).
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { motion } from 'motion/react';
import { ArrowRight } from '@phosphor-icons/react';
import type { AuthState } from '@cine/shared';
import { api, ApiError } from '../lib/api';
import { Button } from '../components/controls';
import { EASE_OUT } from '../lib/motion';
import '../styles/login.css';

/** Bobine au trait, à demi sortie du cadre ; tourne très lentement. */
function Reel() {
  const holes = [0, 72, 144, 216, 288].map((a) => {
    const r = (a - 90) * Math.PI / 180;
    return <circle key={a} cx={200 + Math.cos(r) * 96} cy={200 + Math.sin(r) * 96} r="44" />;
  });
  return (
    <svg className="login__reel" viewBox="0 0 400 400" aria-hidden>
      <g className="login__reel-spin">
        <circle cx="200" cy="200" r="190" />
        <circle cx="200" cy="200" r="172" strokeDasharray="1 7" />
        {holes}
        <circle cx="200" cy="200" r="18" />
      </g>
      <circle className="login__reel-hub" cx="200" cy="200" r="6" />
    </svg>
  );
}

export function Login({ state, onDone }: { state: AuthState; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true); setError(null);
    try { await api.login(pw); onDone(); }
    catch (err) {
      setError(err instanceof ApiError ? (err.status === 0 ? 'Serveur injoignable.' : err.message) : 'Échec de la connexion.');
      setPw(''); input.current?.focus();
    } finally { setBusy(false); }
  };

  const open = state.configured;
  const rise = (i: number) => ({ initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.9, ease: EASE_OUT, delay: 0.15 + i * 0.09 } });

  return (
    <main className="login">
      <div className="login__bar login__bar--top" aria-hidden />
      <Reel />
      <div className="login__inner">
        <motion.p className="t-mono login__kicker" {...rise(0)}>
          <span>Cinémathèque</span><span className="login__rule" aria-hidden /><span>Séance privée</span>
        </motion.p>
        <motion.h1 className="login__title" {...rise(1)}>
          {open ? <>Le rideau<br />est <em>tiré.</em></> : <>La salle<br />est <em>fermée.</em></>}
        </motion.h1>
        {open ? (
          <motion.form className="login__form" onSubmit={submit} {...rise(2)}>
            <label className="t-mono login__label" htmlFor="login-pw">Mot de passe</label>
            <div className={`login__field${error ? ' is-error' : ''}`}>
              <input id="login-pw" ref={input} type="password" value={pw} autoComplete="current-password"
                aria-invalid={!!error} aria-describedby={error ? 'login-err' : undefined}
                onChange={(e) => { setPw(e.target.value); setError(null); }} />
              <Button type="submit" variant="primary" icon={<ArrowRight />} disabled={!pw || busy}>{busy ? 'Ouverture…' : 'Entrer'}</Button>
            </div>
            <p id="login-err" className="login__error" role="alert">{error ?? ' '}</p>
          </motion.form>
        ) : (
          <motion.p className="login__text" {...rise(2)}>
            Aucun mot de passe n'est défini pour l'accès à distance. Sur l'ordinateur qui fait tourner la Cinémathèque,
            ouvrir <span className="t-mono">Réglages → Accès distant</span> et en choisir un.
          </motion.p>
        )}
      </div>
      <motion.p className="t-mono login__foot" aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.2, delay: 0.6 }}>
        <span>BOB. 00</span><span>Projection réservée</span>
      </motion.p>
      <div className="login__bar login__bar--bottom" aria-hidden />
    </main>
  );
}
