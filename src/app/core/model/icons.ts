import { Kind } from './types';

/** 24×24 stroke icon paths, taken from the design. */
export const ICONS = {
  logo: 'M5 4h5v5H5z M14 15h5v5h-5z M10 6.5h3a3.5 3.5 0 0 1 3.5 3.5v5',
  bot: 'M12 8V4H8 M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z M2 14h2 M20 14h2 M15 13v2 M9 13v2',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  terminal: 'M4 17l6-6-6-6 M12 19h8',
  rule: 'M3 17l2 2 4-4 M3 7l2 2 4-4 M13 6h8 M13 12h8 M13 18h8',
  plug: 'M12 22v-5 M9 8V2 M15 8V2 M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z',
  file: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z M14 2v4a2 2 0 0 0 2 2h4 M10 9H8 M16 13H8 M16 17H8',
  sliders: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M2 14h4 M10 8h4 M18 16h4',
  gear: 'M20 7h-9 M14 17H5 M17 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M7 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  hook: 'M15 10l5 5-5 5 M4 4v7a4 4 0 0 0 4 4h12',
  type: 'M4 7V4h16v3 M9 20h6 M12 4v16',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5V8z M3 8l9 5 9-5 M12 13v8',
  db: 'M4 5c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  folder: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
  dash: 'M3 3h7v9H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 16h7v5H3z',
  network: 'M5 3h4v4H5z M15 17h4v4h-4z M15 3h4v4h-4z M9 5h6 M7 7v8a4 4 0 0 0 4 4h4',
  shield: 'M20 13c0 5-3.5 7.5-7.7 8.9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z M9 12l2 2 4-4',
  branch: 'M6 3v12 M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 9a9 9 0 0 1-9 9',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3',
  chevD: 'M6 9l6 6 6-6',
  chevR: 'M9 18l6-6-6-6',
  panelL: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 3v18',
  panelR: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M15 3v18',
  panelB: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M3 15h18',
  plus: 'M5 12h14 M12 5v14',
  minus: 'M5 12h14',
  x: 'M18 6L6 18 M6 6l12 12',
  square: 'M6 6h12v12H6z',
  fit: 'M8 3H5a2 2 0 0 0-2 2v3 M21 8V5a2 2 0 0 0-2-2h-3 M3 16v3a2 2 0 0 0 2 2h3 M16 21h3a2 2 0 0 0 2-2v-3',
  layout: 'M4 4h6v6H4z M14 4h6v6h-6z M9 14h6v6H9z M7 10v2h10v-2 M12 12v2',
  grid: 'M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18',
  more: 'M12 12h.01 M19 12h.01 M5 12h.01',
  grip: 'M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01',
  alert: 'M21.7 18l-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z M12 9v4 M12 17h.01',
  xCircle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M15 9l-6 6 M9 9l6 6',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01',
  check: 'M20 6L9 17l-5-5',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M6.3 17.7l-1.4 1.4 M19.1 4.9l-1.4 1.4',
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z',
  cmdk: 'M9 6v12 M15 6v12 M6 9h12 M6 15h12 M9 6a3 3 0 1 0-3 3 M15 6a3 3 0 1 1 3 3 M9 18a3 3 0 1 1-3-3 M15 18a3 3 0 1 0 3-3',
  trash: 'M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  code: 'M16 18l6-6-6-6 M8 6l-6 6 6 6',
  unlink: 'M9 17H7A5 5 0 0 1 7 7h2 M15 7h2a5 5 0 0 1 0 10h-2 M3 3l18 18',
  undo: 'M3 7v6h6 M21 17a9 9 0 0 0-15-6.7L3 13',
  arrowUR: 'M7 7h10v10 M7 17L17 7',
  copy: 'M8 8h12v12H8z M16 8V4H4v12h4',
  pencil: 'M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z',
  save: 'M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7 M7 3v4a1 1 0 0 0 1 1h7',
} as const;

export type IconName = keyof typeof ICONS;

const KIND_ICON: Record<Kind, IconName> = {
  agent: 'bot',
  skill: 'zap',
  cmd: 'terminal',
  mcp: 'plug',
  rule: 'rule',
  mem: 'file',
};

export function iconFor(type: Kind): IconName {
  return KIND_ICON[type];
}

export const SEVERITY_ICON: Record<'err' | 'warn' | 'info', IconName> = {
  err: 'xCircle',
  warn: 'alert',
  info: 'info',
};
