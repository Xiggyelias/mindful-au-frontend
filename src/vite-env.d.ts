/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** IANA zone id, e.g. `Africa/Harare`. Defaults to Harare if unset. */
  readonly VITE_DISPLAY_TIMEZONE?: string;
}
