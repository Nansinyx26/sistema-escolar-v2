/**
 * main.tsx
 * React application entry point. Mounts the root component and imports
 * global styles.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import PortalResponsavel from './pages/PortalResponsavel';
import './styles/global.scss';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root not found in the document.');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <PortalResponsavel />
  </React.StrictMode>,
);
