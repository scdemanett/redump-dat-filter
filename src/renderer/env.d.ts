export {};

declare global {
  interface Window {
    datAPI: import('../../electron/preload').DatAPI;
  }
}

