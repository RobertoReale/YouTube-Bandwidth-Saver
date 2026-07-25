/**
 * Icone SVG usate nella UI (overlay e player).
 * In linea con il design system di YouTube (linee pulite, monocromatiche).
 */

export const ICONS = {
  // Icona usata nel player per attivare/disattivare il risparmio banda
  bandwidthSaver: `
    <svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
      <path d="M12 3a9 9 0 0 0-9 9c0 4.2 2.9 7.7 6.8 8.8l.5-1.9c-2.9-.9-5.1-3.6-5.1-6.9 0-4 3.3-7.2 7.2-7.2s7.2 3.3 7.2 7.2c0 3.3-2.1 6-5.1 6.9l.5 1.9C19 19.7 21 16.2 21 12a9 9 0 0 0-9-9zm1 5h-2v5.5l3.5 3.5 1.4-1.4-2.9-2.9V8z"/>
    </svg>
  `,
  bandwidthSaverOff: `
    <svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
      <path d="M12 3a9 9 0 0 0-9 9c0 1.9.6 3.6 1.6 5l1.4-1.4A7 7 0 0 1 5.2 12 7.2 7.2 0 0 1 12 4.8c2.4 0 4.6 1.1 5.9 2.9l1.4-1.4A9 9 0 0 0 12 3zm0 18c-1.9 0-3.6-.6-5-1.6l1.4-1.4A7 7 0 0 0 12 19.2c2.4 0 4.6-1.1 5.9-2.9l1.4 1.4A9 9 0 0 1 12 21zm-9.3-1.6L2.1 18 18 2.1l.6.6-15.9 15.9z"/>
    </svg>
  `,
} as const;
