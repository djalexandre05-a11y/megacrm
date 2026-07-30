import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/globals.css';

// O bootstrap do /setup dispara um redeploy no meio da sessão: os chunks
// hasheados da versão antiga somem (404) e um lazy-import quebraria a tela.
// O Vite emite `vite:preloadError` nesses casos — recarregamos para buscar o
// HTML/chunks novos. Guard por timestamp: no máximo 1 reload por minuto, para
// nunca entrar em loop se o problema persistir.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'ah.chunk-reload-at';
  const last = Number(sessionStorage.getItem(KEY) ?? 0);
  if (Date.now() - last < 60_000) return; // já tentamos há pouco; deixa o erro subir
  sessionStorage.setItem(KEY, String(Date.now()));
  event.preventDefault();
  window.location.reload();
});

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root element is missing from index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
