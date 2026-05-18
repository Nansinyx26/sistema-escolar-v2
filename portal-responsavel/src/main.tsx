/**
 * main.tsx
 * React application entry point. Mounts the root component and imports
 * global styles.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import PortalResponsavel from './pages/PortalResponsavel';
import './styles/global.scss';

import { GoogleOAuthProvider } from '@react-oauth/google';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root not found in the document.');
}

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '372860477730-co8eq29vbsafmffmfm2v2ot5givurar1.apps.googleusercontent.com';

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={clientId}>
      <PortalResponsavel />
    </GoogleOAuthProvider>
  </React.StrictMode>,
);
