import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { Recovery } from './Recovery.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Recovery>
      <App />
    </Recovery>
  </StrictMode>,
);
