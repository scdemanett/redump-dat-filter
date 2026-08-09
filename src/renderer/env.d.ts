/// <reference types="vite/client" />

export {};

declare global {
  interface Window {
    datAPI: import('../../electron/preload').DatAPI;
  }
}

