// Inline SVG icons. No emoji anywhere in the UI.
// Stroke icons inherit colour through currentColor.

const svg = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;

export const icons = {
  // sun, moon, close and clock are the theme doc's own paths.
  sun: svg(`<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>`),
  moon: svg(`<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>`),
  close: svg(`<path d="M18 6 6 18M6 6l12 12"/>`),
  clock: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>`),

  coffee: svg(
    `<path d="M4 9h13v5.5A4.5 4.5 0 0 1 12.5 19h-4A4.5 4.5 0 0 1 4 14.5V9Z"/><path d="M17 10.5h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M7 4.5c0 1-.9 1.2-.9 2.2 0 .7.45 1 .45 1M11 4.5c0 1-.9 1.2-.9 2.2 0 .7.45 1 .45 1"/>`
  ),
  trophy: svg(
    `<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5.5A1.5 1.5 0 0 0 4 7.5 3.5 3.5 0 0 0 7.5 11H8M16 6h2.5A1.5 1.5 0 0 1 20 7.5a3.5 3.5 0 0 1-3.5 3.5H16"/><path d="M12 13v4M8.5 20h7M10 17h4"/>`
  ),
  settings: svg(
    `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>`
  ),
  refresh: svg(`<path d="M20 11a8 8 0 0 0-14.3-4.3L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.3L20 15.5"/><path d="M20 20v-4.5h-4.5"/>`),
  check: svg(`<path d="m5 12.5 4.5 4.5L19 7.5"/>`),
  offline: svg(
    `<path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 0 1 6-.8M5 13a10 10 0 0 1 4.2-2.6M12.8 10.1A10 10 0 0 1 19 13M2 9.5a15 15 0 0 1 4.3-2.8M10.5 5.6A15 15 0 0 1 22 9.5"/><circle cx="12" cy="19.5" r=".6" fill="currentColor"/>`
  ),
  // A cloud with rain under it, and one with a bolt.
  rain: svg(`<path d="M7 15.5a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8a3.75 3.75 0 0 1 .5 7.5H7Z"/><path d="M8.5 18.5 7.8 20.5M12.5 18.5l-.7 2M16.5 18.5l-.7 2"/>`),
  storm: svg(`<path d="M7 15.5a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8a3.75 3.75 0 0 1 .5 7.5H7Z"/><path d="m12.8 13-2.3 3.8h3l-2.3 4"/><path d="M7.5 18.5l-.6 1.6M17 18.5l-.6 1.6"/>`),
  heartFilled: svg(
    `<path d="M12 20.2 4.9 13a5 5 0 0 1 7.1-7l0 0a5 5 0 0 1 7.1 7L12 20.2Z" fill="currentColor" stroke="none"/>`
  ),

  // The game.
  play: svg(`<path d="M7 5v14l11-7Z"/>`),
  pause: svg(`<path d="M8 5v14M16 5v14"/>`),
  stepBack: svg(`<path d="M17 5v14L8 12Z"/><path d="M6 5v14"/>`),
  stepForward: svg(`<path d="M7 5v14l9-7Z"/><path d="M18 5v14"/>`),
  replay: svg(`<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M10 9v6l5-3Z"/>`),
  share: svg(`<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M8 11H6.5A2.5 2.5 0 0 0 4 13.5v5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-5a2.5 2.5 0 0 0-2.5-2.5H16"/>`),
  copy: svg(`<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>`),
  link: svg(`<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>`),
  wifi: svg(
    `<path d="M2 9.5a15 15 0 0 1 20 0M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r=".6" fill="currentColor"/>`
  ),
  exit: svg(`<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>`),
  back: svg(`<path d="M15 5l-7 7 7 7"/>`),
  volume: svg(`<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>`),
  volumeOff: svg(`<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>`),
  users: svg(
    `<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9.5" r="2.5"/><path d="M15.8 14.2A4.5 4.5 0 0 1 21 18.5"/>`
  ),
  user: svg(`<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>`),
  bot: svg(`<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V5M12 4.5v0"/><circle cx="12" cy="4" r="1"/><circle cx="9.5" cy="13" r="1.1" fill="currentColor"/><circle cx="14.5" cy="13" r="1.1" fill="currentColor"/><path d="M10 16.2h4M3 12.5v2.5M21 12.5v2.5"/>`),
  phone: svg(`<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5h2"/>`),
  wind: svg(`<path d="M3 8h10.5a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 12h15.5a2.5 2.5 0 1 1-2.5 2.5"/><path d="M3 16h7"/>`),
  arrowUp: svg(`<path d="M12 20V5M6 11l6-6 6 6"/>`),
  heart: svg(`<path d="M12 20.2 4.9 13a5 5 0 0 1 7.1-7l0 0a5 5 0 0 1 7.1 7L12 20.2Z"/>`),
  timer: svg(`<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M10 2.5h4"/>`),
  seed: svg(`<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>`),
  help: svg(`<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2.2-2.4 3.7"/><circle cx="12" cy="17.3" r=".6" fill="currentColor"/>`),

  // The four games.
  archery: svg(`<circle cx="11" cy="13" r="8"/><circle cx="11" cy="13" r="4.5"/><circle cx="11" cy="13" r="1.2" fill="currentColor"/><path d="M11 13 20 4M17 3.5l3 .5.5 3M15.5 5.5 18.5 8.5"/>`),
  darts: svg(`<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21M5.6 5.6l2.5 2.5M15.9 15.9l2.5 2.5M18.4 5.6l-2.5 2.5M8.1 15.9l-2.5 2.5"/>`),
  hoops: svg(`<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18"/><path d="M5.6 5.6C8 8 8 16 5.6 18.4M18.4 5.6C16 8 16 16 18.4 18.4"/>`),
  kicks: svg(`<circle cx="12" cy="12" r="9"/><path d="m12 7.5 4.3 3.1-1.6 5h-5.4l-1.6-5Z"/><path d="M12 3v4.5M16.3 10.6l4.3-1.4M14.7 15.6l2.6 3.7M9.3 15.6l-2.6 3.7M7.7 10.6 3.4 9.2"/>`),

  // The Edge Tray.
  chevron: svg(`<path d="m9 5 7 7-7 7"/>`),
};

export function icon(name) {
  return icons[name] || "";
}
