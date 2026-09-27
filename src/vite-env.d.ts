/// <reference types="vite/client" />

// Ambient types for Vite's import.meta.env (used by src/lib/db.ts and src/lib/auth.tsx).
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly [key: string]: unknown;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}