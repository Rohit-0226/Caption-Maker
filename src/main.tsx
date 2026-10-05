import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/fonts.css';
import './styles/global.css';
import './components/ui.css';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element is missing from index.html');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
