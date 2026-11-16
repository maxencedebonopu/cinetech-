import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { IconContext } from '@phosphor-icons/react';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource-variable/geist/wght.css';
import '@fontsource-variable/geist-mono/wght.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/tv.css';
import { App } from './App';
import { registerServiceWorker } from './lib/pwa';
import { initTv } from './lib/spatial';

initTv();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <MotionConfig reducedMotion="user">
        <IconContext.Provider value={{ weight: 'thin', size: '1em' }}>
          <App />
        </IconContext.Provider>
      </MotionConfig>
    </BrowserRouter>
  </StrictMode>,
);
