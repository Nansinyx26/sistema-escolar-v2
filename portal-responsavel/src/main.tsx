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
import { BIProvider } from './context/BIContext';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root not found in the document.');
}

const PLACEHOLDER_CLIENT_IDS = new Set([
  'seu_client_id.apps.googleusercontent.com',
  '',
]);

function resolveGoogleClientId(): string | null {
  const envVars = [
    import.meta.env.VITE_GMAIL_CLIENT_ID,
    import.meta.env.VITE_GMAIL_ID,
    import.meta.env.VITE_GOOGLE_CLIENT_ID,
  ];

  const validId = envVars.find(
    (id) => id && id.trim() !== '' && !PLACEHOLDER_CLIENT_IDS.has(id.trim())
  );

  if (validId) return validId.trim();

  // Fallback homologado como última instância
  return '372860477730-co8eq29vbsafmffmfm2v2ot5givurar1.apps.googleusercontent.com';
}

const clientId = resolveGoogleClientId();

function MissingClientIdScreen() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#09090b',
        color: '#fff',
        fontFamily: 'Inter, system-ui, sans-serif',
        padding: '24px',
        textAlign: 'center',
        gap: '12px',
      }}
    >
      <p style={{ fontSize: '1.1rem', fontWeight: 600 }}>
        Login com Google não configurado
      </p>
      <p style={{ color: '#a0a0a0', maxWidth: '420px', lineHeight: 1.5 }}>
        Adicione <code style={{ color: '#00d4ff' }}>VITE_GMAIL_CLIENT_ID</code> ao
        arquivo <code style={{ color: '#00d4ff' }}>.env</code> do portal com o Client ID
        do Google Cloud Console.
      </p>
    </div>
  );
}

function RootComponent() {
  if (!clientId) {
    return <MissingClientIdScreen />;
  }

  return (
    <BIProvider>
      <GoogleOAuthProvider clientId={clientId}>
        <PortalResponsavel />
      </GoogleOAuthProvider>
    </BIProvider>
  );
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>,
);
