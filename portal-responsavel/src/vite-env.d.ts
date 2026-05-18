/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_GMAIL_CLIENT_ID: string;
  readonly VITE_GMAIL_REDIRECT_URI: string;
  readonly VITE_DIRECTOR_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
