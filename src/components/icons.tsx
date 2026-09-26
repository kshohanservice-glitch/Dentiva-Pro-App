// Dentiva Pro — inline SVG icon set (offline, no icon font dependency).

import type React from 'react';

function I({ children, size = 19 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const Icons = {
  dashboard: <I><rect x="3" y="3" width="7.5" height="9" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5" /><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.5" /><rect x="3" y="15" width="7.5" height="6" rx="1.5" /></I>,
  patients: <I><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19.5c.6-3.2 2.9-5 5.5-5s4.9 1.8 5.5 5" /><circle cx="17" cy="9.5" r="2.4" /><path d="M15.5 14.6c2.3.3 4.1 1.9 4.6 4.4" /></I>,
  calendar: <I><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></I>,
  queue: <I><path d="M4 6h16M4 12h16M4 18h10" /><circle cx="19" cy="18" r="2.2" /></I>,
  treatments: <I><path d="M12 3v18M5 8l14 8M19 8L5 16" /><circle cx="12" cy="12" r="2" /></I>,
  rx: <I><path d="M6 3h9l4 4v14H6z" /><path d="M9 13h6M12 10v6" /></I>,
  invoice: <I><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9.5 8.5h5M9.5 12h5M9.5 15.5h3" /></I>,
  payments: <I><rect x="3" y="6.5" width="18" height="12" rx="2" /><circle cx="12" cy="12.5" r="2.6" /><path d="M6.5 9.5h.01M17.5 15.5h.01" /></I>,
  inventory: <I><path d="M3.5 8L12 3.5 20.5 8v8L12 20.5 3.5 16z" /><path d="M3.5 8L12 12.5 20.5 8M12 12.5v8" /></I>,
  accounting: <I><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></I>,
  staff: <I><circle cx="12" cy="8" r="3.4" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></I>,
  backup: <I><ellipse cx="12" cy="6" rx="7" ry="2.6" /><path d="M5 6v6c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6" /><path d="M5 12v6c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-6" /></I>,
  settings: <I><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.1-1.2L14 2H10l-.4 2.7a7 7 0 0 0-2.1 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2.1 1.2L10 22h4l.4-2.7a7 7 0 0 0 2.1-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" /></I>,
  about: <I><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 7.5h.01" /></I>,
  reports: <I><path d="M5 3h14v18H5z" /><path d="M9 8h6M9 12h6M9 16h4" /></I>,
  audit: <I><path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z" /><path d="M9.5 12l2 2 3.5-4" /></I>,
  bell: <I><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5h-15z" /><path d="M10 21a2 2 0 0 0 4 0" /></I>,
  lock: <I><rect x="5" y="11" width="14" height="9.5" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></I>,
  search: <I><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></I>,
  collapse: <I><path d="M14 6l-6 6 6 6" /></I>,
  expand: <I><path d="M10 6l6 6-6 6" /></I>,
  tooth: <I size={22}><path d="M7.5 3.5C5 3.5 3.8 5.4 4.2 8c.3 2 .8 3.2 1.2 5.2.3 1.6.5 3.4 1.1 5 .2.7.9 1.3 1.6 1.1 1.3-.4 1.1-2.3 1.3-3.6.1-1.1.3-2.6 1.6-2.6s1.5 1.5 1.6 2.6c.2 1.3 0 3.2 1.3 3.6.7.2 1.4-.4 1.6-1.1.6-1.6.8-3.4 1.1-5 .4-2 .9-3.2 1.2-5.2.4-2.6-.8-4.5-3.3-4.5-1.5 0-2.4.8-4.5.8s-3-.8-4.5-.8z" /></I>,
  plus: <I><path d="M12 5v14M5 12h14" /></I>,
  print: <I><path d="M7 8V3h10v5" /><rect x="4" y="8" width="16" height="9" rx="2" /><path d="M7 14h10v7H7z" /></I>,
  x: <I><path d="M6 6l12 12M18 6L6 18" /></I>,
  check: <I><path d="M5 12.5l4.5 4.5L19 7.5" /></I>,
  logout: <I><path d="M14 4h-8v16h8" /><path d="M10 12h11M18 8.5L21.5 12 18 15.5" /></I>,
};
