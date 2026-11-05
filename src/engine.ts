import type { Account, Candle, Direction, Feed, Forecast, Position, Round, Signal } from './types';

export const STARTING_BALANCE = 1000;
export const PRACTICE_DURATION = 20_000;
export const PRACTICE_INSTALLATION = 'squeek-practice-v1';

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function currentRound(feed: Feed, now: number): number {
  return Math.max(1, Math.floor((now - feed.genesis) / feed.duration) + 1);
}

export function isFresh(feed: Feed, now: number): boolean {
  return now - feed.receivedAt < feed.staleAfter * 1000 &&
    now - feed.fetchedAt < 60_000 && feed.freshness === 'online' && feed.wheelStatus !== 'COUNTER_FAULT';
}

export function streak(account: Account, ai = false): number {
  let n = 0;
  for (const p of [...account.positions].reverse()) {
    if (p.status === 'pending' || p.status === 'void') continue;
    if ((ai ? (p.aiPnl ?? 0) > 0 : p.status === 'won')) n++;
    else break;
  }
  return n;
}

export function multiplier(account: Account, ai = false): number {
  return Math.min(2, 1 + streak(account, ai) * 0.1);
}

export function accountStats(account: Account, ai = false) {
  const closed = account.positions.filter(p => p.status === 'won' || p.status === 'lost');
  const wins = closed.filter(p => ai ? (p.aiPnl ?? 0) > 0 : p.status === 'won').length;
  return {
    trades: closed.length,
    wins,
    winRate: closed.length ? Math.round(wins / closed.length * 100) : null,
    pnl: Math.round(closed.reduce((sum, p) => sum + (ai ? p.aiPnl ?? 0 : p.pnl ?? 0), 0) * 100) / 100,
    streak: streak(account, ai),
  };
}

export function detectSignals(rounds: Round[], projectedWork?: number): Signal[] {
  const history = rounds.slice(-12).map(r => r.work);
  if (history.length < 4) return [
    { id: 'momentum', name: 'Momentum breakout', state: 'insufficient', direction: null, detail: 'Needs 4 observed rounds.' },
    { id: 'reclaim', name: 'Range reclaim', state: 'insufficient', direction: null, detail: 'Needs 4 observed rounds.' },
    { id: 'reversal', name: 'Potential reversal zone', state: 'insufficient', direction: null, detail: 'Needs 4 observed rounds.' },
  ];
  const last = projectedWork ?? history.at(-1)!;
  const prior = projectedWork === undefined ? history.slice(0, -1) : history;
  const center = median(prior);
  const high = Math.max(...prior);
  const prev = prior.at(-1)!;
  const before = prior.at(-2) ?? prev;
  const momentum = last > Math.max(1, high * 1.15);
  const reclaim = prev < center && last >= Math.max(1, center) && last > prev;
  const exhaustion = prev > Math.max(1, center * 1.5) && last < prev * 0.7;
  const rebound = prev === 0 && before === 0 && last > 0;
  return [
    { id: 'momentum', name: 'Momentum breakout', state: momentum ? 'active' : 'watching', direction: momentum ? 'long' : null,
      detail: momentum ? 'Pace cleared the 12-round high by 15%.' : 'Watching for pace 15% above the recent high.' },
    { id: 'reclaim', name: 'Range reclaim', state: reclaim ? 'active' : 'watching', direction: reclaim ? 'long' : null,
      detail: reclaim ? 'Pace crossed back above the recent median.' : 'Waiting for a move back above the median.' },
    { id: 'reversal', name: 'Potential reversal zone', state: exhaustion || rebound ? 'active' : 'watching', direction: exhaustion ? 'short' : rebound ? 'long' : null,
      detail: exhaustion ? 'Pace fell 30% after an extended run.' : rebound ? 'Activity returned after two idle rounds.' : 'Watching for exhaustion or a restart after rest.' },
  ];
}

export function projectWork(feed: Feed, now: number): number {
  const elapsed = Math.max(0, Math.min(feed.duration, (now - feed.genesis) % feed.duration));
  const futureSeconds = (feed.duration - elapsed) / 1000;
  const extra = feed.metersPerWork ? feed.speed / feed.metersPerWork * futureSeconds : 0;
  return Math.max(0, Math.round(feed.openWork + extra));
}

export function forecast(feed: Feed, now: number): Forecast {
  const history = feed.rounds.slice(-12).map(r => r.work);
  const target = Math.max(1, Math.round(median(history)));
  const projected = projectWork(feed, now);
  const recent = history.slice(-3);
  const mean = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const expected = 0.65 * projected + 0.35 * mean;
  const direction: Direction = expected >= target ? 'long' : 'short';
  const difference = Math.abs(expected - target) / Math.max(target, expected, 1);
  const strength = Math.round(50 + Math.min(35, difference * 35));
  return {
    direction, strength, target,
    reason: direction === 'long' ? 'Current pace and recent work lean above the target.' : 'Current pace and recent work lean below the target.',
  };
}

export function makeCandles(rounds: Round[], live?: { round: number; work: number; projected: number; endAt: number }): Candle[] {
  let previous = rounds.length ? 100 + rounds[0].work : 100;
  const candles: Candle[] = rounds.map(round => {
    const close = 100 + round.work;
    const candle = { time: round.endAt, round: round.id, open: previous, high: Math.max(previous, close), low: Math.min(previous, close), close, volume: round.work };
    previous = close;
    return candle;
  });
  if (live) candles.push({ time: live.endAt, round: live.round, open: previous,
    high: Math.max(previous, 100 + live.projected), low: Math.min(previous, 100 + live.projected),
    close: 100 + live.projected, volume: live.work, provisional: true });
  return candles;
}

export function placePrediction(account: Account, args: {
  id: string; installation: string; round: number; direction: Direction; stake: number;
  forecast: Forecast; now: number; opensAt: number; fresh: boolean;
}): Account {
  if (!args.fresh) throw new Error('The feed is stale. Refresh it before predicting.');
  if (args.now >= args.opensAt) throw new Error('This round has started. Refresh to predict the next one.');
  if (account.positions.some(p => p.status === 'pending')) throw new Error('Wait for your open prediction to settle.');
  if (account.positions.some(p => p.installation === args.installation && p.round === args.round)) throw new Error('You already predicted this round.');
  if (!Number.isFinite(args.stake) || !Number.isInteger(args.stake) || args.stake < 10 || args.stake > 250 || args.stake > account.balance) {
    throw new Error('Choose a whole-number stake from 10 to 250 SQK, within your balance.');
  }
  const position: Position = { id: args.id, installation: args.installation, round: args.round, direction: args.direction,
    aiDirection: args.forecast.direction, aiStrength: args.forecast.strength, target: args.forecast.target,
    stake: args.stake, multiplier: multiplier(account), aiMultiplier: multiplier(account, true), createdAt: args.now, status: 'pending' };
  return { ...account, balance: account.balance - args.stake, positions: [...account.positions, position] };
}

export function settleAccount(account: Account, rounds: Round[], installation: string, settledThrough: number, now: number): Account {
  const pending = account.positions.find(p => p.status === 'pending');
  if (!pending) return account;
  const round = rounds.find(r => r.id === pending.round);
  let settled: Position;
  let balance = account.balance;
  let aiBalance = account.aiBalance;
  // Never infer a per-round result from a mixed multi-round batch.
  if (pending.installation !== installation || (!round && settledThrough >= pending.round + 2)) {
    settled = { ...pending, status: 'void', pnl: 0, aiPnl: 0, settledAt: now,
      note: pending.installation !== installation ? 'The API installation changed. Stake returned.' : 'Exact round result unavailable. Stake returned.' };
    balance += pending.stake;
  } else if (round && pending.round <= settledThrough) {
    const actual: Direction = round.work >= pending.target ? 'long' : 'short';
    const won = actual === pending.direction;
    const pnl = won ? Math.round(pending.stake * pending.multiplier * 100) / 100 : -pending.stake;
    const aiPnl = actual === pending.aiDirection ? Math.round(pending.stake * pending.aiMultiplier * 100) / 100 : -pending.stake;
    balance += pending.stake + pnl;
    aiBalance += aiPnl;
    settled = { ...pending, status: won ? 'won' : 'lost', pnl, aiPnl, work: round.work, settledAt: now };
  } else return account;
  return { balance: Math.round(balance * 100) / 100, aiBalance: Math.round(aiBalance * 100) / 100,
    positions: account.positions.map(p => p.id === pending.id ? settled : p) };
}

// Synthetic, deterministic practice data. Never used as a live fallback.
export function practiceWork(step: number): number {
  const wave = 170 + Math.sin(step * 0.68) * 100 + Math.cos(step * 1.7) * 55;
  return Math.max(0, Math.round(wave + (step % 11 === 0 ? 220 : 0)));
}

export function practiceFeed(step: number, now: number, startedAt: number): Feed {
  const duration = 600_000;
  const genesis = startedAt - (step + 48) * duration;
  const rounds: Round[] = Array.from({ length: 48 }, (_, i) => ({ id: step + i + 1, work: practiceWork(step + i),
    endAt: genesis + (step + i + 1) * duration, source: 'practice' }));
  const elapsed = Math.max(0, Math.min(1, (now - startedAt) / duration));
  const pace = practiceWork(step + 48);
  return { installation: PRACTICE_INSTALLATION, generatedAt: now, observedAt: now, receivedAt: now, fetchedAt: now,
    staleAfter: 120, freshness: 'online', provenance: 'simulated', wheelStatus: pace > 0 ? 'ACTIVE' : 'IDLE', speed: pace * 0.878 / 600, rpm: pace / 10,
    distance: 3840 + elapsed * pace * 0.878, openWork: Math.round(pace * elapsed), genesis, duration,
    settledThrough: step + 48, rounds, metersPerWork: 0.878, historicalMedian: 170 };
}
