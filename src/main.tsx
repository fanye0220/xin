import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Load theme preference on startup
if (localStorage.getItem('tavern_theme') === 'light') {
  document.documentElement.classList.add('light-theme');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
