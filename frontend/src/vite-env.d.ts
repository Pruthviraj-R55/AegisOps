/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SAAS_API_URL?: string;
  readonly VITE_COLLECTOR_EGRESS_URL?: string;
  readonly VITE_COLLECTOR_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
