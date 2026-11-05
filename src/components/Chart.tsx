import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Candle } from '../types';
import { Icon } from './Icons';

const fmt = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n);
const time = (n: number) => new Date(n).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });

export function Chart({ candles, mode, onExplain, expanded = false, onExpand }: {
  candles: Candle[]; mode: 'live' | 'practice'; onExplain: () => void; expanded?: boolean; onExpand?: () => void;
}) {
  const [period, setPeriod] = useState(24);
  const [style, setStyle] = useState<'candles' | 'line'>('candles');
  const [hover, setHover] = useState<number | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 326 });
  useLayoutEffect(() => {
    const element = surface.current!;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const lastTime = candles.at(-1)?.time ?? 0;
  const visible = candles.filter(c => c.time >= lastTime - period * 3_600_000);
  const selected = visible[Math.min(hover ?? visible.length - 1, visible.length - 1)];
  const min = Math.min(90, ...visible.map(c => c.low)) * 0.9;
  const max = Math.max(200, ...visible.map(c => c.high)) * 1.08;
  const W = size.width, H = size.height, left = 14, right = W - 64, top = 16, bottom = H - 90;
  const firstRound = visible[0]?.round ?? 0;
  const slots = Math.max((visible.at(-1)?.round ?? firstRound) - firstRound + 1, 18);
  const step = (right - left) / slots;
  const x = (i: number) => left + step * ((visible[i]?.round ?? firstRound) - firstRound + 0.5);
  const y = (n: number) => bottom - (n - min) / (max - min) * (bottom - top);
  const maxVolume = Math.max(1, ...visible.map(c => c.volume));
  const linePath = visible.map((c, i) => `${i ? 'L' : 'M'}${x(i)},${y(c.close)}`).join(' ');
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      setHover(i => e.key === 'Home' ? 0 : e.key === 'End' ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, (i ?? visible.length - 1) + (e.key === 'ArrowLeft' ? -1 : 1))));
    }
  };
  return <section className={`chart-panel ${expanded ? 'expanded-chart' : ''}`} aria-labelledby={expanded ? 'expanded-chart-label' : 'chart-label'} id={expanded ? undefined : 'chart'}>
    <div className="chart-topline">
      <div className="instrument"><span className="instrument-icon"><Icon name="activity" size={22} /></span><div><h2 id={expanded ? 'expanded-chart-label' : 'chart-label'}>Hamster / Work index</h2><span className="muted caption">Squeekchain · {mode === 'practice' ? 'Simulated replay' : '10-minute rounds'}</span></div></div>
      {onExpand && <button className="icon-button" onClick={onExpand} aria-label="Expand chart"><Icon name="expand" /></button>}
    </div>
    <div className="chart-toolbar">
      <div className="periods" role="group" aria-label="Chart range">{[4, 12, 24].map(p => <button key={p} onClick={() => { setPeriod(p); setHover(null); }} aria-pressed={period === p}>{p}h</button>)}</div>
      <div className="chart-tools" role="group" aria-label="Chart style"><button className="icon-button" aria-label="Show candlesticks" aria-pressed={style === 'candles'} onClick={() => setStyle('candles')}><Icon name="candles" /></button><button className="icon-button" aria-label="Show line chart" aria-pressed={style === 'line'} onClick={() => setStyle('line')}><Icon name="line" /></button><span className="tool-divider" /><button className="icon-button" aria-label="How the work index is calculated" onClick={onExplain}><Icon name="info" /></button></div>
    </div>
    <div className="ohlc mono" aria-live="off">
      {selected ? <><span className="selected-round">#{selected.round}{selected.provisional ? ' projected' : ''}</span><span>O <b>{fmt(selected.open)}</b></span><span>H <b>{fmt(selected.high)}</b></span><span>L <b>{fmt(selected.low)}</b></span><span>C <b className={selected.close >= selected.open ? 'positive' : 'negative'}>{fmt(selected.close)}</b></span></> : <span>Waiting for confirmed round history</span>}
    </div>
    <div ref={surface} className="chart-canvas" tabIndex={0} role="img" aria-label={`${style === 'candles' ? 'Candlestick' : 'Line'} work index chart with ${visible.length} observations. Use arrow keys to inspect rounds. ${selected ? `Selected round ${selected.round}, open ${selected.open}, high ${selected.high}, low ${selected.low}, close ${selected.close}.` : 'No observations yet.'}`} onKeyDown={onKeyDown}
      onPointerMove={event => { const r = event.currentTarget.getBoundingClientRect(); const pointer = event.clientX - r.left; let closest = 0; visible.forEach((_, i) => { if (Math.abs(x(i) - pointer) < Math.abs(x(closest) - pointer)) closest = i; }); setHover(closest); }} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <g className="chart-grid">{Array.from({ length: 5 }, (_, i) => {
          const value = min + (max - min) * i / 4;
          return <g key={i}><line x1={left} y1={y(value)} x2={right} y2={y(value)} /><text x={right + 12} y={y(value) + 4}>{Math.round(value).toLocaleString('en-US')}</text></g>;
        })}{Array.from({ length: 7 }, (_, i) => <line key={i} x1={left + (right - left) * i / 6} x2={left + (right - left) * i / 6} y1={top} y2={H - 35} />)}</g>
        <text x="26" y={bottom / 2} className="chart-watermark">squeek.</text>
        <text x="29" y={bottom / 2 + 26} className="chart-watermark-caption">Powered by one very small trader.</text>
        {visible.map((c, i) => {
          const up = c.close >= c.open;
          const width = Math.max(1, Math.min(12, step * 0.64));
          return <g key={`${c.round}-${c.time}`} className={up ? 'candle-up' : 'candle-down'}>
            {style === 'candles' && <><line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} strokeWidth="1.4" /><rect x={x(i) - width / 2} y={Math.min(y(c.open), y(c.close))} width={width} height={Math.max(2, Math.abs(y(c.open) - y(c.close)))} fillOpacity={c.provisional ? 0.65 : 1} rx="0.8" /></>}
            <rect x={x(i) - width / 2} y={H - 35 - c.volume / maxVolume * 32} width={width} height={c.volume > 0 ? Math.max(1, c.volume / maxVolume * 32) : 0} opacity="0.55" rx="0.6" />
          </g>;
        })}
        {style === 'line' && <path d={linePath} className="chart-line" />}
        {selected && <><line className="price-line" x1={left} x2={right} y1={y(visible.at(-1)!.close)} y2={y(visible.at(-1)!.close)} />
          <rect x={right + 6} y={y(visible.at(-1)!.close) - 11} width={57} height={22} rx="3" className="price-tag" />
          <text x={right + 34} y={y(visible.at(-1)!.close) + 4} className="price-tag-text">{fmt(visible.at(-1)!.close)}</text>
          {hover !== null && <><line x1={x(hover)} x2={x(hover)} y1={top} y2={H - 35} className="crosshair" /><circle cx={x(hover)} cy={y(selected.close)} r="4" className="chart-point" /></>}
        </>}
        <g className="chart-time">{visible.filter((_, i) => i % Math.max(1, Math.ceil(visible.length / (W < 450 ? 3 : 5))) === 0).map((c, i) => <text key={c.round} x={x(visible.indexOf(c))} y={H - 9} textAnchor={i === 0 ? 'start' : 'middle'}>{time(c.time)}</text>)}</g>
        <text x={right + 14} y={H - 9} className="chart-time">UTC</text>
      </svg>
      {!visible.length && <div className="chart-empty"><Icon name="activity" size={28} /><span>Waiting for round history</span><p className="muted">Refresh the live feed or switch to practice.</p></div>}
    </div>
    <div className="chart-foot"><span><i className="legend-dot" />Wheel work <span className="mono">{selected ? fmt(selected.volume) : '–'}</span></span><span className="muted">Activity index · not a token price</span></div>
    <details className="chart-data"><summary>View candle data</summary><div className="data-table-wrap"><table><caption className="sr-only">Work index candles, newest first</caption><thead><tr><th>Round</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Work</th></tr></thead><tbody>{[...visible].reverse().slice(0, 24).map(c => <tr key={c.round}><th>#{c.round}{c.provisional ? ' projected' : ''}</th><td>{fmt(c.open)}</td><td>{fmt(c.high)}</td><td>{fmt(c.low)}</td><td>{fmt(c.close)}</td><td>{fmt(c.volume)}</td></tr>)}</tbody></table></div></details>
  </section>;
}
