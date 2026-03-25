/// <reference types="vite/client" />

declare module "virtual:ec-env" {
  export const SENTRY_DSN: string;
  export const APP_ENV: string;
}
