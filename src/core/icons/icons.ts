/**
 * kadam 0.3 (F8): the built-in named icons, drawn for Kadam on a 24-unit grid
 * with 2-unit round strokes. Each is the inside of an `<svg viewBox="0 0 24 24">`
 * that strokes in `currentColor`, so an icon takes its colour from the text
 * around it. Only the icons a page uses are written into it.
 */
const line = (d: string): string => `<path d="${d}"/>`;
const circle = (cx: number, cy: number, r: number): string => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
const rect = (x: number, y: number, width: number, height: number, rx: number): string =>
  `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}"/>`;

export const ICONS: Readonly<Record<string, string>> = {
  "arrow right": line("M5 12h14M13 6l6 6-6 6"),
  "arrow left": line("M19 12H5M11 6l-6 6 6 6"),
  "arrow up": line("M12 19V5M6 11l6-6 6 6"),
  "arrow down": line("M12 5v14M6 13l6 6 6-6"),
  "chevron right": line("M9 6l6 6-6 6"),
  "chevron left": line("M15 6l-6 6 6 6"),
  "chevron up": line("M6 15l6-6 6 6"),
  "chevron down": line("M6 9l6 6 6-6"),
  check: line("M5 12.5l4.5 4.5L19 7"),
  close: line("M6 6l12 12M18 6L6 18"),
  plus: line("M12 5v14M5 12h14"),
  minus: line("M5 12h14"),
  menu: line("M4 7h16M4 12h16M4 17h16"),
  search: circle(11, 11, 6) + line("M20 20l-4.8-4.8"),
  home: line("M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5"),
  mail: rect(3, 5, 18, 14, 2) + line("M3.5 7l8.5 6 8.5-6"),
  user: circle(12, 8, 4) + line("M4 20c0-4 3.6-6 8-6s8 2 8 6"),
  star: line("M12 3.5l2.2 5.9 6.4.3-5 4 1.7 6.1-5.3-3.5-5.3 3.5 1.7-6.1-5-4 6.4-.3z"),
  heart: line("M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"),
  "external link": line("M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"),
  download: line("M12 4v11M7 10l5 5 5-5M5 20h14"),
  upload: line("M12 15V4M7 9l5-5 5 5M5 20h14"),
  calendar: rect(4, 5, 16, 15, 2) + line("M4 10h16M9 3v4M15 3v4"),
  clock: circle(12, 12, 9) + line("M12 7v5l3 2"),
  info: circle(12, 12, 9) + line("M12 11v6M12 7.5v.01"),
  warning: line("M12 4l9 16H3zM12 10v4M12 17v.01"),
  lock: rect(5, 11, 14, 9, 2) + line("M8 11V8a4 4 0 0 1 8 0v3"),
  link: line("M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"),
  play: line("M8 5v14l11-7z"),
  pause: line("M9 5v14M15 5v14"),
  sun: circle(12, 12, 4) + line("M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"),
  moon: line("M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"),
  globe: circle(12, 12, 9) + line("M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"),
  "map pin": line("M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z") + circle(12, 10, 2.5),
  copy: rect(8, 8, 12, 12, 2) + line("M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"),
  trash: line("M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"),
  pencil: line("M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"),
  bell: line("M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"),
  message: line("M4 5h16v11H9l-5 4z"),
  phone: line("M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"),
  settings: line("M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1") + circle(15, 6, 2) + circle(9, 12, 2) + circle(17, 18, 2),
  filter: line("M4 5h16l-6 8v6l-4-2v-4z"),
  share: circle(6, 12, 2.5) + circle(18, 6, 2.5) + circle(18, 18, 2.5) + line("M8.3 10.8l7.4-3.6M8.3 13.2l7.4 3.6"),
  image: rect(3, 5, 18, 14, 2) + circle(9, 10, 1.5) + line("M21 16l-5-5-9 8"),
  file: line("M6 3h8l5 5v13H6zM14 3v5h5"),
};

export const ICON_NAMES: readonly string[] = Object.keys(ICONS).sort();

/** The whole `<svg>` for a named icon; `label` null means decorative. */
export function iconSvg(name: string, classAttribute: string, nodeId: string, label: string | null): string {
  const body = ICONS[name];
  if (body === undefined) throw new Error(`unknown icon ${name}`);
  const a11y = label === null ? 'aria-hidden="true"' : `role="img" aria-label="${label}"`;
  return `<svg class="${classAttribute}" data-kdm-id="${nodeId}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${body}</svg>`;
}
