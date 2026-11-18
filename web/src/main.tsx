import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Session } from './app/session';
import { reloadOnStaleChunk } from './lib/stale-chunk';
import { messenger } from './messenger/store';
import '@fontsource-variable/onest/index.css';
import '@fontsource-variable/unbounded/index.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';
import './theme.css';

reloadOnStaleChunk();

const session = new Session();
void messenger.init();

// The e2e injection hook exists only in `vite build --mode test`; in production
// builds this branch is constant-false and the module is never bundled.
if (import.meta.env.MODE === 'test') {
  session.warmUp();
  void import('./test-hook').then((hook) => {
    hook.installTestHook(session);
  });
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App session={session} />
    </StrictMode>,
  );
}

import './product.css';

import './conversation/conversation.css';
import './recognition/recognition.css';
import './messenger/messenger.css';
import './redesign.css';
