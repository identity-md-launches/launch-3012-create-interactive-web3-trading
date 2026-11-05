import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { fetchFeed } from './api';
import { accountStats, currentRound, detectSignals, forecast, isFresh, makeCandles, multiplier, placePrediction, PRACTICE_DURATION, PRACTICE_INSTALLATION, practiceFeed, practiceWork, projectWork, settleAccount } from './engine';
import { createPlayer, csvFor, loadStore, saveStore } from './storage';
import type { Account, Direction, Feed, GameStore, Mode, Position, Round } from './types';
import { Chart } from './components/Chart';
import { Dialog } from './components/Dialog';
import { HamsterMark, Icon, WheelArt } from './components/Icons';

const amount = (n: number, digits = 0) => new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${amount(Math.abs(n), n % 1 ? 1 : 0)}`;
const duration = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const age = (ms: number) => ms < 60_000 ? `${Math.max(0, Math.floor(ms / 1000))}s ago` : `${Math.floor(ms / 60_000)}m ago`;
const directionLabel = (d: Direction) => d === 'long' ? 'Long' : 'Short';
type Modal = 'help' | 'index' | 'players' | 'chart' | null;

function updateAccount(store: GameStore, playerId: string, mode: Mode, fn: (a: Account) => Account): GameStore {
  let changed = false;
  const players = store.players.map(p => {
    if (p.id !== playerId) return p;
    const account = fn(p[mode]);
    if (account === p[mode]) return p;
    changed = true;
    return { ...p, [mode]: account };
  });
  return changed ? { ...store, players } : store;
}

export function App() {
  const [loaded] = useState(loadStore);
  const [store, setStore] = useState<GameStore>(loaded.store);
  const [storageWarning, setStorageWarning] = useState(loaded.warning);
  const [mode, setMode] = useState<Mode>('live');
  const [now, setNow] = useState(Date.now());
  const [practiceAnchor, setPracticeAnchor] = useState(Date.now());
  const [live, setLive] = useState<Feed | null>(null);
  const liveRef = useRef<Feed | null>(null);
  const inFlight = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState('');
  const [direction, setDirection] = useState<Direction>('long');
  const [stake, setStake] = useState('50');
  const [formError, setFormError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [detail, setDetail] = useState<Position | null>(null);
  const [activityTab, setActivityTab] = useState<'positions' | 'rounds'>('positions');
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState('');
  const stakeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const previousPositions = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const feed = await fetchFeed(liveRef.current, controller.signal);
      if (!controller.signal.aborted) { liveRef.current = feed; setLive(feed); setApiError(''); }
    } catch (error) {
      if (!controller.signal.aborted) setApiError(error instanceof TypeError ? 'Unable to reach Squeekchain. Refresh to retry.' : error instanceof Error && error.name === 'TimeoutError' ? 'Squeekchain took too long to respond. Refresh to retry.' : error instanceof Error ? error.message : 'Unable to reach Squeekchain. Refresh to retry.');
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => { if (!document.hidden) void refresh(); }, 15_000);
    const onVisible = () => { if (!document.hidden) { setNow(Date.now()); void refresh(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(poll); abort.current?.abort(); document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!saveStore(store)) setStorageWarning('Browser storage is unavailable. This session will not survive a reload.'); }, [store]);
  useEffect(() => {
    const onStorage = () => { const result = loadStore(); setStore(result.store); setStorageWarning(result.warning); };
    addEventListener('storage', onStorage);
    return () => removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (!live) return;
    setStore(s => {
      let next = s;
      for (const p of s.players) next = updateAccount(next, p.id, 'live', a => settleAccount(a, live.rounds, live.installation, live.settledThrough, Date.now()));
      return next;
    });
  }, [live]);

  const finishPractice = useCallback((forceRound?: number) => {
    setStore(s => {
      const due = s.players.flatMap(p => p.practice.positions).filter(p => p.status === 'pending' &&
        (forceRound ? p.round <= forceRound : Date.now() >= p.createdAt + PRACTICE_DURATION));
      if (!due.length) return s;
      const through = Math.max(...due.map(p => p.round));
      const rounds: Round[] = due.map(p => ({ id: p.round, work: practiceWork(p.round - 1), endAt: Date.now(), source: 'practice' }));
      let next = s;
      for (const p of s.players) next = updateAccount(next, p.id, 'practice', a => settleAccount(a, rounds, PRACTICE_INSTALLATION, through, Date.now()));
      return { ...next, practiceStep: Math.max(s.practiceStep, through - 48) };
    });
    setPracticeAnchor(Date.now());
  }, []);
  useEffect(() => {
    if (store.players.some(p => p.practice.positions.some(t => t.status === 'pending' && now >= t.createdAt + PRACTICE_DURATION))) finishPractice();
  }, [now, store.players, finishPractice]);

  const player = store.players.find(p => p.id === store.activePlayer)!;
  const account = player[mode];
  const pending = account.positions.find(p => p.status === 'pending');
  const recentResult = !pending ? account.positions.at(-1) : undefined;
  const feed = useMemo(() => mode === 'practice' ? practiceFeed(store.practiceStep, now, practiceAnchor) : live, [mode, store.practiceStep, now, practiceAnchor, live]);
  const fresh = mode === 'practice' || !!(live && isFresh(live, now) && !apiError);
  const round = feed ? currentRound(feed, now) : null;
  const nextRound = round ? round + 1 : null;
  const ai = feed ? forecast(feed, now) : null;
  const work = feed ? projectWork(feed, now) : 0;
  const signals = detectSignals(feed?.rounds ?? [], feed ? work : undefined);
  const stats = accountStats(account);
  const aiStats = accountStats(account, true);
  const candles = useMemo(() => feed ? makeCandles(feed.rounds, { round: currentRound(feed, now), work: feed.openWork, projected: projectWork(feed, now),
    endAt: feed.genesis + currentRound(feed, now) * feed.duration }) : [], [feed, now]);
  const opensAt = feed && nextRound ? feed.genesis + (nextRound - 1) * feed.duration : 0;
  const active = !!feed && feed.speed > 0 && feed.wheelStatus !== 'IDLE' && fresh;
  const canPredict = fresh && !!feed && !!ai && (feed.rounds.length >= 4 || mode === 'practice') && !pending;

  useEffect(() => {
    for (const p of account.positions) {
      if (previousPositions.current.get(p.id) === 'pending' && p.status !== 'pending') {
        setAnnouncement(p.status === 'void' ? `Round ${p.round} voided. Stake returned.` : `Round ${p.round} settled. You ${p.status}. ${signed(p.pnl ?? 0)} virtual SQK.`);
      }
      previousPositions.current.set(p.id, p.status);
    }
  }, [account.positions]);

  function changeMode(next: Mode) {
    setMode(next); setFormError(''); setAnnouncement(next === 'practice' ? 'Practice mode. All data and SQK are simulated.' : 'Live mode. Predictions follow confirmed Squeekchain rounds.');
  }

  function submitPrediction(event: FormEvent) {
    event.preventDefault(); setFormError('');
    if (!feed || !ai || !nextRound || !canPredict) { setFormError('Wait for a fresh feed, or try a practice round.'); return; }
    try {
      const updated = placePrediction(account, { id: crypto.randomUUID(), installation: feed.installation, round: nextRound, direction,
        stake: Number(stake), forecast: ai, now: Date.now(), opensAt: mode === 'practice' ? Date.now() + PRACTICE_DURATION : opensAt, fresh });
      setStore(s => updateAccount(s, player.id, mode, () => updated));
      setAnnouncement(`${directionLabel(direction)} prediction locked for round ${nextRound}. ${stake} virtual SQK reserved.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to lock the prediction. Try again.');
      stakeRef.current?.focus();
    }
  }

  function addPlayer(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name || name.length > 24 || /[\u0000-\u001f]/.test(name)) { setNameError('Enter a trader name with 1–24 characters.'); nameRef.current?.focus(); return; }
    if (store.players.some(p => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { setNameError('That name is already here. Choose it above or use another name.'); nameRef.current?.focus(); return; }
    if (store.players.length >= 12) { setNameError('This browser already has 12 traders. Select an existing trader.'); nameRef.current?.focus(); return; }
    const created = createPlayer(name);
    setStore(s => ({ ...s, activePlayer: created.id, players: [...s.players, created] }));
    setModal(null); setNewName(''); setNameError(''); setFormError('');
    setAnnouncement(`Trading as ${name}. Starting with 1,000 virtual SQK in each mode.`);
  }

  function exportHistory() {
    const url = URL.createObjectURL(new Blob([csvFor(account)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `squeek-${mode}-positions.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setAnnouncement('Position history exported as CSV.');
  }

  const leaderboard = [
    ...store.players.map(p => ({ id: p.id, name: p.name, stats: accountStats(p[mode]), isAI: false, current: p.id === player.id })),
    { id: 'ai', name: 'Squeek AI', stats: aiStats, isAI: true, current: false },
  ].sort((a, b) => b.stats.pnl - a.stats.pnl || b.stats.wins - a.stats.wins || Number(a.isAI) - Number(b.isAI));

  return <>
    <a className="skip-link" href="#predict">Skip to prediction</a>
    <header className="app-header">
      <a href="#" className="brand" aria-label="Squeek terminal home"><span className="brand-mark"><HamsterMark /></span><span>squeek<span className="brand-period">.</span></span><span className="brand-divider" /><span className="brand-product">Price action</span></a>
      <nav className="desktop-nav" aria-label="Main navigation"><a href="#terminal" className="nav-active"><Icon name="terminal" />Terminal</a><a href="#activity"><Icon name="history" />Activity</a><a href="#leaderboard"><Icon name="trophy" />Leaderboard</a></nav>
      <div className="header-actions"><button className="icon-button help-button" aria-label="How to play" onClick={() => setModal('help')}><Icon name="help" size={20} /></button><button className="profile-button" onClick={() => { setNameError(''); setModal('players'); }}><span className="avatar"><Icon name="user" size={16} /></span><span className="profile-name">{player.name === 'You' ? 'Your desk' : player.name}</span><Icon name="chevron" size={14} /></button></div>
    </header>

    <div className="app-shell">
      <aside className="side-rail" aria-label="Terminal shortcuts"><div className="rail-top"><a className="rail-link selected" href="#terminal" aria-label="Trading terminal"><Icon name="terminal" size={21} /></a><a className="rail-link" href="#activity" aria-label="Prediction activity"><Icon name="history" size={21} /></a><a className="rail-link" href="#leaderboard" aria-label="Local leaderboard"><Icon name="trophy" size={21} /></a></div><a className="rail-link" href="https://docs.squeekchain.com/developers/api/" target="_blank" rel="noreferrer" aria-label="Squeekchain API documentation (opens in a new tab)"><Icon name="globe" size={21} /></a></aside>
      <main id="terminal">
        <div className="page-heading"><div><h1>Price action terminal<span className="heading-dot">.</span></h1><p className="muted">Read the wheel. Predict the next round.</p></div><div className="mode-switch" role="group" aria-label="Game mode"><button aria-pressed={mode === 'live'} onClick={() => changeMode('live')}><Icon name="globe" size={14} />Live API{mode === 'live' && <Icon name="check" size={14} />}</button><button aria-pressed={mode === 'practice'} onClick={() => changeMode('practice')}><Icon name="play" size={14} />Practice{mode === 'practice' && <Icon name="check" size={14} />}</button></div></div>

        <div className={`feed-line ${mode === 'practice' ? 'practice-line' : ''}`}>
          <span className="feed-status"><span className={`status-dot ${mode === 'live' && !fresh ? 'status-wait' : ''}`} />{mode === 'practice' ? 'Practice · simulated data' : loading && !live ? 'Connecting to Squeekchain' : fresh ? 'Squeekchain connected' : live ? 'Feed is stale' : 'Live feed unavailable'}</span>
          <span className="feed-meta">{mode === 'practice' ? '20-second replay' : live ? `${live.provenance} · updated ${age(now - live.receivedAt)}` : 'Public API · no wallet needed'}</span>
          {mode === 'live' && <button className="refresh-button" disabled={loading} onClick={() => void refresh()} aria-label="Refresh live feed"><Icon name="refresh" size={14} /><span>Refresh</span></button>}
        </div>
        {mode === 'live' && apiError && <div className="notice warning" role="status"><Icon name="info" /><span>{apiError} {live ? 'Last good values are retained.' : 'Try Practice to play immediately.'}</span></div>}
        {storageWarning && <div className="notice warning" role="status"><Icon name="info" /><span>{storageWarning}</span><button className="icon-button" aria-label="Dismiss storage notice" onClick={() => setStorageWarning('')}><Icon name="close" /></button></div>}

        <section className="market-strip" aria-label="Wheel telemetry">
          <div className="market-stat index-stat"><span className="stat-label">Work index <span className="unit-tag">{mode === 'practice' ? 'Simulated' : 'Projected'}</span></span><div><strong className="mono">{feed ? amount(100 + work, 1) : '–'}</strong><span className="stat-note">pts</span></div></div>
          <div className="market-stat"><span className="stat-label">Wheel speed</span><div><strong className="mono">{feed ? amount(feed.speed, 2) : '–'}</strong><span className="stat-note">m/s</span></div><span className="stat-detail">{feed ? amount(feed.rpm, 1) : '–'} rpm</span></div>
          <div className="market-stat"><span className="stat-label">Today’s distance</span><div><strong className="mono">{feed ? amount(feed.distance / 1000, 2) : '–'}</strong><span className="stat-note">km</span></div><span className="stat-detail">Device measurement day</span></div>
          <div className="market-stat round-stat"><span className="stat-label">Current round</span><div><strong className="mono">{round ? `#${round}` : '–'}</strong><span className={`round-state ${active ? 'positive' : ''}`}><i />{!feed ? loading ? 'Loading' : 'Unavailable' : !fresh ? 'Stale' : active ? 'Running' : 'Resting'}</span></div><span className="stat-detail">{feed ? `${amount(feed.openWork)} wheel units so far` : 'Awaiting telemetry'}</span></div>
        </section>

        <div className="trading-grid">
          <section className="prediction-panel" aria-labelledby="prediction-label" id="predict">
            <div className="panel-heading"><h2 id="prediction-label">Beat the AI</h2><button className="icon-button" onClick={() => setModal('help')} aria-label="Prediction game rules"><Icon name="help" size={17} /></button></div>
            <div className="ticket-round"><div><span className="muted">{pending ? 'Your open prediction' : 'Predict the next round'}</span><strong className="mono">{pending ? `#${pending.round}` : nextRound ? `#${nextRound}` : 'Waiting for feed'}</strong></div><span className={`ticket-clock ${pending ? 'locked-clock' : ''}`}><Icon name={pending ? 'lock' : 'history'} size={14} /><span>{pending ? mode === 'practice' ? duration(pending.createdAt + PRACTICE_DURATION - now) : 'Locked' : mode === 'practice' ? '20s replay' : feed ? duration(opensAt - now) : '--:--'}</span></span></div>
            <div className="round-progress" aria-hidden="true"><span style={{ width: `${pending && mode === 'practice' ? Math.max(0, (pending.createdAt + PRACTICE_DURATION - now) / PRACTICE_DURATION * 100) : feed ? Math.max(0, Math.min(100, (opensAt - now) / feed.duration * 100)) : 0}%` }} /></div>

            <div className="ai-forecast"><div className="ai-identity"><span className="ai-icon"><Icon name="cpu" size={19} /></span><div><strong>Squeek AI predicts</strong><span className="caption muted">Rules-based opponent</span></div></div><div className={`ai-direction ${(pending?.aiDirection ?? ai?.direction) === 'long' ? 'positive' : 'negative'}`}>{(pending || ai) && <Icon name={(pending?.aiDirection ?? ai?.direction) === 'long' ? 'arrowUp' : 'arrowDown'} size={18} />}{pending ? directionLabel(pending.aiDirection) : ai ? directionLabel(ai.direction) : '–'}</div></div>
            <div className="ai-strength"><span className="muted caption">Signal strength</span><div className="strength-meter" aria-hidden="true">{[1, 2, 3, 4, 5].map(n => <i key={n} className={(pending?.aiStrength ?? ai?.strength ?? 0) / 20 >= n ? 'filled' : ''} />)}</div><span className="mono caption">{pending?.aiStrength ?? ai?.strength ?? '–'}{ai || pending ? '/100' : ''}</span></div>

            <form onSubmit={submitPrediction} noValidate>
              <fieldset className="direction-field" disabled={!!pending}><legend>Pick a side</legend><div className="direction-options">{(['long', 'short'] as const).map(d => <label className={`direction-option ${d} ${direction === d && !pending || pending?.direction === d ? 'is-selected' : ''}`} key={d}><input type="radio" name="direction" value={d} checked={(pending?.direction ?? direction) === d} onChange={() => setDirection(d)} /><Icon name={d === 'long' ? 'arrowUp' : 'arrowDown'} size={20} /><span>{directionLabel(d)}<small>{d === 'long' ? 'Fast run' : 'Slow run'}</small></span>{(pending?.direction ?? direction) === d && <Icon name="check" size={14} />}</label>)}</div></fieldset>
              <div className="target-line"><span>Target</span><strong className="mono">{pending?.target ?? ai?.target ?? '–'} wheel units</strong><button type="button" className="inline-info" onClick={() => setModal('help')} aria-label="How the prediction target works"><Icon name="info" size={14} /></button></div>
              <div className="stake-label"><label htmlFor="stake">Virtual stake</label><span className="muted caption">Balance <b className="mono">{amount(account.balance, account.balance % 1 ? 1 : 0)}</b> SQK</span></div>
              <div className={`stake-input ${formError ? 'has-error' : ''}`}><input ref={stakeRef} id="stake" name="stake" type="number" inputMode="numeric" min="10" max="250" step="1" value={pending ? pending.stake : stake} disabled={!!pending} onChange={e => { setStake(e.target.value); setFormError(''); }} aria-invalid={!!formError} aria-describedby="stake-help stake-error" /><span>SQK</span></div>
              {!pending && <div className="stake-presets" role="group" aria-label="Quick stake">{[25, 50, 100, 250].map(value => <button type="button" key={value} onClick={() => { setStake(String(value)); setFormError(''); }} aria-pressed={Number(stake) === value}>{value}</button>)}</div>}
              <div className="ticket-returns"><span className="muted">Potential profit <span className="caption">({amount(pending?.multiplier ?? multiplier(account), 1)}×)</span></span><strong className="mono positive">+{amount(pending ? pending.stake * pending.multiplier : Math.max(0, Math.min(250, Number(stake) || 0)) * multiplier(account), 1)} SQK</strong></div>
              <p id="stake-error" className="field-error" role="alert">{formError}</p>
              {recentResult && <div className="settlement-note"><Icon name={recentResult.status === 'won' ? 'check' : 'info'} size={16} /><span className="mono caption">#{recentResult.round}</span><strong className={recentResult.status === 'won' ? 'positive' : recentResult.status === 'lost' ? 'negative' : ''}>{recentResult.status === 'void' ? 'Stake returned' : `You ${recentResult.status === 'won' ? 'won +' : 'lost '}${amount(Math.abs(recentResult.pnl ?? 0), (recentResult.pnl ?? 0) % 1 ? 1 : 0)} SQK`}</strong><button type="button" className="inline-info" aria-label={`View result for round ${recentResult.round}`} onClick={() => setDetail(recentResult)}><Icon name="arrowRight" size={15} /></button></div>}
              <button type="submit" className="primary-button lock-prediction" disabled={!canPredict} aria-label={pending ? 'Prediction locked' : `Lock ${directionLabel(direction)} prediction`}><Icon name={pending ? 'lock' : 'bolt'} size={18} />{pending ? `${directionLabel(pending.direction)} prediction locked` : `Lock ${directionLabel(direction)} prediction`}{!pending && <Icon name="arrowRight" size={18} />}</button>
              <p id="stake-help" className="ticket-help caption muted">{pending ? mode === 'practice' ? 'The simulated round settles when the timer ends.' : 'Settles after this round is confirmed on Squeekchain.' : mode === 'practice' ? 'Simulated data. Virtual SQK. No wallet needed.' : !fresh ? 'Waiting for a fresh feed. Practice is always available.' : feed && feed.rounds.length < 4 ? 'Waiting for 4 confirmed rounds to make a prediction.' : 'Locks before the next round starts. Virtual SQK only.'}</p>
              {pending && mode === 'practice' && <button type="button" className="text-button fast-forward" onClick={() => finishPractice(pending.round)}>Fast-forward round<Icon name="arrowRight" size={15} /></button>}
              {!pending && account.balance < 10 && <button type="button" className="text-button" onClick={() => setModal('players')}>Create a new trader to play again<Icon name="arrowRight" size={15} /></button>}
            </form>
            <div className="hamster-status"><div><span className="hamster-name"><i className={`status-dot ${!active ? 'status-neutral' : ''}`} />Squeektoshi is {active ? 'running' : 'resting'}</span><p className="muted caption">{mode === 'practice' ? 'A little practice. A sharper instinct.' : 'His next move. Your next call.'}</p></div><WheelArt active={active} /></div>
          </section>

          <div className="chart-column"><Chart candles={candles} mode={mode} onExplain={() => setModal('index')} onExpand={() => setModal('chart')} />
            <section className="signals-panel" aria-labelledby="signals-label"><div className="section-heading"><h2 id="signals-label"><Icon name="spark" size={17} />Signal engine</h2><span className="caption muted">12-round lookback</span></div><div className="signals-list">{signals.map((s, i) => <article key={s.id} className={`signal-item ${s.state === 'active' ? 'signal-active' : ''}`}><span className="signal-number mono">0{i + 1}</span><div><div className="signal-title"><h3>{s.name}</h3><span className={`signal-state ${s.state === 'active' ? 'positive' : ''}`}>{s.state === 'active' ? `${directionLabel(s.direction!)} signal` : s.state === 'insufficient' ? 'Building' : 'Watching'}</span></div><p className="muted caption">{s.detail}</p></div><Icon name={s.state === 'active' ? 'bolt' : 'activity'} size={16} /></article>)}</div></section>
          </div>
        </div>

        <section className="performance-strip" aria-labelledby="performance-label"><div className="performance-title"><Icon name="activity" size={20} /><div><h2 id="performance-label">Your performance</h2><span className="caption muted">{mode === 'practice' ? 'Practice account' : 'Live account'} · virtual SQK</span></div></div><div><span className="stat-label">Net PnL</span><strong className={`mono ${stats.pnl > 0 ? 'positive' : stats.pnl < 0 ? 'negative' : ''}`}>{signed(stats.pnl)} <small>SQK</small></strong></div><div><span className="stat-label">Win rate</span><strong className="mono">{stats.winRate === null ? '–' : `${stats.winRate}%`}<small>{stats.trades} settled</small></strong></div><div><span className="stat-label">Win streak</span><strong className="mono">{stats.streak}<small>{amount(multiplier(account), 1)}× multiplier</small></strong></div><div><span className="stat-label">Edge vs AI</span><strong className={`mono ${stats.pnl - aiStats.pnl > 0 ? 'positive' : stats.pnl - aiStats.pnl < 0 ? 'negative' : ''}`}>{signed(stats.pnl - aiStats.pnl)}<small>SQK</small></strong></div></section>

        <div className="bottom-grid"><section className="activity-panel" id="activity" aria-label="Trading activity"><div className="activity-heading"><div className="activity-tabs" role="group" aria-label="Activity view"><button aria-pressed={activityTab === 'positions'} onClick={() => setActivityTab('positions')}>My positions<span className="tab-count mono">{account.positions.length}</span></button><button aria-pressed={activityTab === 'rounds'} onClick={() => setActivityTab('rounds')}>Round history</button></div><button className="icon-button" onClick={exportHistory} disabled={!account.positions.length} aria-label="Export positions as CSV"><Icon name="download" size={17} /></button></div>
          {activityTab === 'positions' ? !account.positions.length ? <div className="empty-positions"><span className="empty-chart-icon"><Icon name="terminal" size={27} /></span><h3>Your first move is waiting</h3><p className="muted">Lock a prediction to start your track record.</p><a href="#predict" className="text-button">Make a prediction<Icon name="arrowRight" size={15} /></a></div> : <div className="positions-table"><table><caption className="sr-only">Your {mode} predictions</caption><thead><tr><th>Round / side</th><th>Stake</th><th>Result</th><th>Net PnL</th></tr></thead><tbody>{[...account.positions].reverse().slice(0, 20).map(p => <tr key={p.id}><td><button className="position-link" onClick={() => setDetail(p)}><span className="mono">#{p.round}</span><span className={p.direction === 'long' ? 'positive' : 'negative'}><Icon name={p.direction === 'long' ? 'arrowUp' : 'arrowDown'} size={13} />{directionLabel(p.direction)}</span></button></td><td className="mono">{amount(p.stake)}</td><td><span className={`result-badge ${p.status === 'won' ? 'positive' : p.status === 'lost' ? 'negative' : ''}`}>{p.status === 'pending' ? 'Open' : p.status === 'won' ? 'Won' : p.status === 'lost' ? 'Lost' : 'Voided'}</span></td><td className={`mono ${p.pnl && p.pnl > 0 ? 'positive' : p.pnl && p.pnl < 0 ? 'negative' : ''}`}>{p.status === 'pending' ? '–' : signed(p.pnl ?? 0)}</td></tr>)}</tbody></table>{account.positions.length > 20 && <p className="table-note caption muted">Showing the latest 20. Export CSV for your full history.</p>}</div> : <div className="positions-table"><table><caption className="sr-only">Recent observed rounds</caption><thead><tr><th>Round</th><th>Wheel work</th><th>Result</th></tr></thead><tbody>{[...(feed?.rounds ?? [])].reverse().slice(0, 10).map(r => <tr key={r.id}><td className="mono">#{r.id}</td><td className="mono">{amount(r.work)} <span className="muted caption">units</span></td><td><span className="round-result"><Icon name="check" size={13} />{mode === 'practice' ? 'Simulated' : 'Confirmed'}</span></td></tr>)}</tbody></table>{!feed?.rounds.length && <p className="table-note muted">Round history will appear after the feed connects.</p>}</div>}
        </section>

        <section className="leaderboard-panel" id="leaderboard" aria-labelledby="leaderboard-label"><div className="section-heading"><h2 id="leaderboard-label"><Icon name="trophy" size={18} />Leaderboard</h2><span className="local-label">This browser</span></div><div className="leaderboard-columns caption muted"><span>Trader</span><span>Win rate</span><span>Net PnL</span></div><ol className="leaderboard-list">{leaderboard.map((entry, i) => <li key={entry.id} className={entry.current ? 'current-player' : ''}><span className={`rank mono ${i === 0 ? 'rank-first' : ''}`}>{i + 1}</span><span className={`leader-avatar ${entry.isAI ? 'robot-avatar' : ''}`}><Icon name={entry.isAI ? 'cpu' : 'user'} size={16} /></span><span className="trader-name">{entry.name}{entry.current && entry.name !== 'You' ? <span className="caption muted">You</span> : entry.isAI ? <span className="caption muted">Your matched stakes</span> : <span className="caption muted">Local trader</span>}</span><span className="mono caption leader-rate">{entry.stats.winRate === null ? '–' : `${entry.stats.winRate}%`}</span><strong className={`mono ${entry.stats.pnl > 0 ? 'positive' : entry.stats.pnl < 0 ? 'negative' : ''}`}>{signed(entry.stats.pnl)}</strong></li>)}</ol><div className="leaderboard-foot"><p className="caption muted">Local players only. {mode === 'practice' ? 'Practice' : 'Live'} scores stay on this device.</p><button className="text-button" onClick={() => { setNameError(''); setModal('players'); }}>Add a trader<Icon name="arrowRight" size={14} /></button></div></section></div>

        <footer className="app-footer"><span><HamsterMark />Small paws. Big price action.</span><div><span className="caption muted">A virtual game, powered by Squeekchain</span><a href="https://docs.squeekchain.com/developers/api/" target="_blank" rel="noreferrer">API docs<Icon name="external" size={12} /></a><button className="text-button" onClick={() => setModal('help')}>Game rules</button></div></footer>
      </main>
    </div>
    <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
    {modal === 'help' && <Dialog title="Read the wheel. Make your call." onClose={() => setModal(null)}><div className="dialog-copy"><p>Predict whether the next 10-minute Squeekchain round will meet a wheel-work target. This is a virtual game: SQK here has no monetary value.</p><ol className="rules-list"><li><strong>Pick Long or Short.</strong><p>Long wins when confirmed work meets or exceeds the target. Short wins when work is below it, including a zero-work round.</p></li><li><strong>Lock before the round starts.</strong><p>The target is the median of the latest 12 observed, confirmed rounds, rounded to a whole unit and at least 1. Your target and the AI’s call are fixed when you lock.</p></li><li><strong>Wait for confirmation.</strong><p>Your 10–250 SQK stake is reserved immediately. A win returns it plus profit of stake × multiplier. A loss costs the stake. Each consecutive win adds 0.1×, up to 2×. A loss resets it.</p></li><li><strong>Beat the benchmark.</strong><p>The AI uses 65% current projected work and 35% mean work from the last three observed rounds. Its score mirrors your stakes. Signal strength is a heuristic score, not a probability or a trained model.</p></li></ol><p>Only one prediction per account can be open. A mixed batch without an exact result is never guessed: after two further settled rounds, the stake is returned. An installation change also returns pending stakes.</p><div className="help-note"><Icon name="play" /><div><strong>Try it in practice</strong><p>Practice uses deterministic simulated data and separate SQK. It settles in 20 seconds, or instantly with Fast-forward. Live rounds follow the chain’s own timing.</p></div></div><p className="muted">Profiles and the leaderboard live in this browser’s storage. They do not sync between devices. No wallet, deposit, token transfer or withdrawal is involved.</p><a className="source-link" href="https://docs.squeekchain.com/developers/api/" target="_blank" rel="noreferrer">Read Squeekchain’s API documentation<Icon name="external" size={15} /></a></div></Dialog>}
    {modal === 'index' && <Dialog title="A market made of movement" onClose={() => setModal(null)}><div className="dialog-copy"><p>The chart is a derived wheel-work index, not a traded SQK price.</p><div className="formula mono">Index = 100 + wheel work units</div><p>Each closed live candle opens at the previous observed round’s close and closes at 100 plus that round’s confirmed work. High and low are those known endpoints. Historical intraround extremes are not available, so the chart does not invent wicks.</p><p>The current, translucent candle projects a finish using accepted open-round work plus the latest speed × time remaining. Distance per unit is estimated from the API’s lifetime observed distance and accepted work. Without that ratio, it shows accepted open work only.</p><p>Daily distance and speed come directly from the device. The device measurement day starts at 12:00 UTC. Missing rounds are omitted, never converted to zero work. Arrow keys on the chart inspect candles; the data table below provides the same values.</p><p className="muted">Momentum breakouts, range reclaims and potential reversal zones use the latest 12 observed rounds and current projected pace. They are game signals, not financial advice.</p></div></Dialog>}
    {modal === 'players' && <Dialog title="Your trading desk" onClose={() => setModal(null)}><p className="dialog-intro muted">Keep separate records for players on this browser.</p><div className="player-list">{store.players.map(p => <button key={p.id} onClick={() => { setStore(s => ({ ...s, activePlayer: p.id })); setModal(null); setFormError(''); }} className={p.id === player.id ? 'selected-player' : ''}><span className="avatar"><Icon name="user" /></span><span>{p.name}</span>{p.id === player.id ? <Icon name="check" /> : <Icon name="arrowRight" />}</button>)}</div><form onSubmit={addPlayer} className="new-player-form" noValidate><label htmlFor="trader-name">New trader name</label><input ref={nameRef} id="trader-name" name="traderName" autoComplete="nickname" type="text" maxLength={24} value={newName} onChange={e => { setNewName(e.target.value); setNameError(''); }} aria-invalid={!!nameError} aria-describedby="name-error name-hint" /><p className="caption muted" id="name-hint">Start with 1,000 virtual SQK in each mode.</p><p role="alert" className="field-error" id="name-error">{nameError}</p><button type="submit" className="primary-button">Create trader<Icon name="arrowRight" /></button></form></Dialog>}
    {modal === 'chart' && <Dialog title="Hamster activity chart" wide onClose={() => setModal(null)}><Chart candles={candles} mode={mode} expanded onExplain={() => setModal('index')} /></Dialog>}
    {detail && <Dialog title={`Round #${detail.round}`} onClose={() => setDetail(null)}><div className="dialog-copy"><p>{detail.status === 'pending' ? detail.installation === PRACTICE_INSTALLATION ? 'Your simulated prediction is locked. The result appears when the practice timer ends.' : 'Your prediction is locked. The final result will appear after confirmation.' : detail.status === 'void' ? detail.note : `${detail.work ?? 0} ${detail.installation === PRACTICE_INSTALLATION ? 'simulated' : 'confirmed'} wheel units. ${detail.work! >= detail.target ? 'Long' : 'Short'} was the winning side.`}</p><dl className="position-detail"><div><dt>Your call</dt><dd>{directionLabel(detail.direction)}</dd></div><div><dt>AI’s locked call</dt><dd>{directionLabel(detail.aiDirection)} · {detail.aiStrength}/100</dd></div><div><dt>Fixed target</dt><dd>{detail.target} wheel units</dd></div><div><dt>Virtual stake</dt><dd>{detail.stake} SQK</dd></div><div><dt>Locked multiplier</dt><dd>{amount(detail.multiplier, 1)}×</dd></div><div><dt>Net PnL</dt><dd>{detail.status === 'pending' ? 'Pending' : `${signed(detail.pnl ?? 0)} SQK`}</dd></div><div><dt>AI’s net PnL</dt><dd>{detail.status === 'pending' ? 'Pending' : `${signed(detail.aiPnl ?? 0)} SQK`}</dd></div></dl></div></Dialog>}
  </>;
}
