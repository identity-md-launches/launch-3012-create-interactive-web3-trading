export function Icon({ name, size = 18, className = '' }: { name: string; size?: number; className?: string }) {
  const paths: Record<string, React.ReactNode> = {
    terminal: <><path d="M4 17V8m5 12V4m5 12V7m5 13V3M2 12h4m1-3h4m1 3h4m1-4h4" /></>,
    activity: <><path d="M3 12h4l3-7 4 14 3-7h4" /></>,
    trophy: <><path d="M8 3h8v6a4 4 0 0 1-8 0V3Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 1v6m-4 2h8" /></>,
    history: <><path d="M3 10a9 9 0 1 1 1 7M3 4v6h6m3-4v6l4 2" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 8.5a2.5 2.5 0 1 1 3.2 2.4c-.7.3-.7 1.1-.7 2.1m0 3h.01" /></>,
    arrowUp: <><path d="m6 15 6-6 6 6M12 9v10" /></>,
    arrowDown: <><path d="m6 9 6 6 6-6m-6 6V5" /></>,
    arrowRight: <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
    chevron: <path d="m8 10 4 4 4-4" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    refresh: <><path d="M20 10a8 8 0 0 0-14-4L3 9m0-6v6h6m-5 5a8 8 0 0 0 14 4l3-3m0 6v-6h-6" /></>,
    bolt: <path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z" />,
    cpu: <><rect x="6" y="6" width="12" height="12" rx="3" /><path d="M10 2v4m4-4v4M10 18v4m4-4v4M2 10h4m-4 4h4m12-4h4m-4 4h4m-12-4h4v4h-4z" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" /></>,
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-3a7 7 0 0 1 14 0v3" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    lock: <><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3" /></>,
    expand: <><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" /></>,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    play: <path d="m8 4 12 8-12 8V4Z" />,
    spark: <path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></>,
    external: <><path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7" /></>,
    candles: <><path d="M6 3v18m12-18v18" /><rect x="3" y="7" width="6" height="8" rx="1" /><rect x="15" y="10" width="6" height="7" rx="1" /></>,
    line: <path d="m3 17 5-8 4 4 4-9 5 4" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{paths[name] ?? paths.activity}</svg>;
}

export function HamsterMark({ className = '' }: { className?: string }) {
  return <svg className={className} width="38" height="38" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M14 34c-2-13 6-22 18-22s20 9 18 22c-1 12-9 19-18 19S15 46 14 34Z" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round" />
    <path d="M16 24c-10-9-2-19 6-9M48 24c10-9 2-19-6-9M23 32v2m18-2v2m-12 6h6m-3 0v5m-7-1c3 5 11 5 14 0" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
  </svg>;
}

export function WheelArt({ active }: { active: boolean }) {
  return <svg viewBox="0 0 170 128" className={`wheel-art ${active ? 'is-running' : ''}`} aria-hidden="true">
    <g className="wheel-lines" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="92" cy="56" r="48" /><circle cx="92" cy="56" r="41" />
      <g className="spokes"><path d="M92 8v15m0 66v15M44 56h15m66 0h15M58 22l11 11m46 46 11 11M58 90l11-11m46-46 11-11" /></g>
      <path d="m80 105-5 15m29-15 5 15m-45 0h56" />
    </g>
    <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M68 81c-5-15 2-29 16-32 6-2 14 0 17 6 7-3 16 3 16 12 7 1 10 5 8 10-3 8-15 12-27 12H80c-10 0-16-3-12-8Z" fill="var(--color-surface)" />
      <path d="M98 56c-2-12 10-17 14-8 2 4 0 9-5 11m-27 30-5 5m27-5 4 4m-37-16c-10 2-14-1-15-5m56-2h.01m9 5 3 1m-30-5c-2 3-3 6-1 9" fill="none" />
    </g>
  </svg>;
}
