/* Declarations for the vendored halftone engine (lib/halftone.js — a vanilla
   port of the landing's HalftoneDots). It is an IIFE: importing it for side
   effects registers window.HalftoneDots. */
export {};

declare global {
  interface Window {
    HalftoneDots: {
      /** Paints `box` as an interactive halftone dot field; returns dispose. */
      attach: (
        box: HTMLElement,
        opts: {
          src: string | null;
          gradient: [string, string] | null;
          accent: string;
          displace?: boolean;
        },
      ) => () => void;
      initAll: (root?: ParentNode) => void;
    };
  }
}
