import test from 'node:test';
import assert from 'node:assert/strict';
import { accountStats, detectSignals, forecast, isFresh, makeCandles, median, multiplier, placePrediction, practiceFeed, practiceWork, settleAccount } from '../src/engine.ts';
import { parseCoreRounds, parseSettlementHistory } from '../src/api.ts';
import { csvFor } from '../src/storage.ts';
import type { Account, Direction, Round } from '../src/types.ts';

const empty = (): Account => ({ balance: 1000, aiBalance: 1000, positions: [] });
const prediction = (account = empty(), direction: Direction = 'long') => placePrediction(account, {
  id: 'prediction-1', installation: 'fixture-installation', round: 10, direction, stake: 50,
  forecast: { direction: 'short', target: 100, strength: 70, reason: 'fixture' }, now: 1000, opensAt: 2000, fresh: true,
});
const round = (work: number, id = 10): Round => ({ id, work, endAt: 6000, source: 'confirmed' });

test('median handles no observations, odd counts, and even counts without mutating input', () => {
  const values = [30, 0, 10, 20];
  assert.equal(median([]), 0); assert.equal(median([2, 1, 3]), 2); assert.equal(median(values), 15); assert.deepEqual(values, [30, 0, 10, 20]);
});
test('placing reserves the stake and freezes the target, AI call and multipliers', () => {
  const a = prediction(); assert.equal(a.balance, 950); assert.equal(a.positions[0].target, 100); assert.equal(a.positions[0].aiDirection, 'short'); assert.equal(a.positions[0].multiplier, 1);
});
test('invalid stakes, stale feeds and started rounds cannot be predicted', () => {
  const base = { id: 'test', installation: 'fixture-installation', round: 1, direction: 'long' as const, stake: 50,
    forecast: { direction: 'long' as const, target: 1, strength: 60, reason: '' }, now: 1000, opensAt: 2000, fresh: true };
  for (const stake of [NaN, Infinity, -1, 0, 9, 251, 10.5]) assert.throws(() => placePrediction(empty(), { ...base, stake }));
  assert.throws(() => placePrediction({ ...empty(), balance: 20 }, base));
  assert.throws(() => placePrediction(empty(), { ...base, fresh: false }));
  assert.throws(() => placePrediction(empty(), { ...base, now: 2000 }));
});
test('one open prediction and one prediction per round are enforced', () => {
  const base = { id: 'other', installation: 'fixture-installation', round: 10, direction: 'long' as const, stake: 10,
    forecast: { direction: 'long' as const, target: 1, strength: 60, reason: '' }, now: 1000, opensAt: 2000, fresh: true };
  assert.throws(() => placePrediction(prediction(), base));
  const settled = settleAccount(prediction(), [round(150)], 'fixture-installation', 10, 7000);
  assert.throws(() => placePrediction(settled, base));
});
test('a winning Long returns the stake plus profit and the AI loses the same stake', () => {
  const a = settleAccount(prediction(), [round(150)], 'fixture-installation', 10, 7000);
  assert.equal(a.balance, 1050); assert.equal(a.aiBalance, 950); assert.equal(a.positions[0].pnl, 50); assert.equal(a.positions[0].aiPnl, -50); assert.equal(a.positions[0].status, 'won');
});
test('exactly meeting the target wins Long', () => {
  assert.equal(settleAccount(prediction(), [round(100)], 'fixture-installation', 10, 7000).positions[0].status, 'won');
});
test('zero work wins Short and a losing stake is not debited twice', () => {
  const a = settleAccount(prediction(), [round(0)], 'fixture-installation', 10, 7000);
  assert.equal(a.balance, 950); assert.equal(a.aiBalance, 1050); assert.equal(a.positions[0].pnl, -50);
  assert.equal(settleAccount(prediction(empty(), 'short'), [round(0)], 'fixture-installation', 10, 7000).positions[0].status, 'won');
});
test('settlement is idempotent and cannot use unconfirmed or missing results', () => {
  const a = prediction(); assert.equal(settleAccount(a, [round(150)], 'fixture-installation', 9, 7000), a);
  assert.equal(settleAccount(a, [], 'fixture-installation', 11, 7000), a);
  const b = settleAccount(a, [round(150)], 'fixture-installation', 10, 7000);
  assert.equal(settleAccount(b, [round(150)], 'fixture-installation', 10, 8000), b);
});
test('a changed installation or unavailable exact result refunds rather than inventing an outcome', () => {
  const changed = settleAccount(prediction(), [], 'new-fixture-installation', 1, 7000);
  assert.equal(changed.balance, 1000); assert.equal(changed.positions[0].status, 'void');
  const missing = settleAccount(prediction(), [], 'fixture-installation', 12, 7000);
  assert.equal(missing.balance, 1000); assert.equal(missing.positions[0].pnl, 0); assert.equal(missing.aiBalance, 1000);
});
test('win streaks increase the next multiplier, cap at 2, and ignore voids', () => {
  const winner = settleAccount(prediction(), [round(150)], 'fixture-installation', 10, 7000);
  assert.equal(multiplier(winner), 1.1);
  const longStreak = { ...winner, positions: Array.from({ length: 20 }, (_, i) => ({ ...winner.positions[0], id: String(i) })) };
  assert.equal(multiplier(longStreak), 2);
  const stats = accountStats(winner); assert.equal(stats.winRate, 100); assert.equal(stats.streak, 1); assert.equal(stats.pnl, 50);
  assert.equal(accountStats(empty()).winRate, null);
});
test('the already locked multiplier is used at settlement', () => {
  const a = prediction(); a.positions[0].multiplier = 1.4;
  const settled = settleAccount(a, [round(130)], 'fixture-installation', 10, 7000);
  assert.equal(settled.balance, 1070); assert.equal(settled.positions[0].pnl, 70);
});
test('all three signal patterns activate on their respective pace patterns', () => {
  const history = [100, 100, 100, 200].map((work, i) => round(work, i + 1));
  assert.equal(detectSignals(history, 240)[0].state, 'active');
  assert.equal(detectSignals([100, 100, 100, 50].map((work, i) => round(work, i + 1)), 110)[1].state, 'active');
  assert.equal(detectSignals(history, 100)[2].direction, 'short');
  assert.equal(detectSignals([0, 0, 0, 0].map((work, i) => round(work, i + 1)), 1)[2].direction, 'long');
  assert.equal(detectSignals([])[0].state, 'insufficient');
});
test('idle history sets a minimum target of one; forecast never asserts a probability', () => {
  const f = practiceFeed(0, 100000, 100000); f.rounds = Array.from({ length: 12 }, (_, i) => round(0, i + 1)); f.speed = 0; f.openWork = 0;
  const result = forecast(f, 100000); assert.equal(result.target, 1); assert.equal(result.direction, 'short'); assert.ok(result.strength >= 50 && result.strength <= 85);
});
test('staleness uses receipt time and failed-poll age, and counter faults are blocked', () => {
  const f = practiceFeed(0, 1000000, 1000000);
  assert.ok(isFresh(f, 1000001)); assert.equal(isFresh(f, 1120001), false);
  assert.equal(isFresh({ ...f, fetchedAt: 930000 }, 1000000), false);
  assert.equal(isFresh({ ...f, wheelStatus: 'COUNTER_FAULT' }, 1000000), false);
  assert.equal(isFresh({ ...f, freshness: 'stale' }, 1000000), false);
});
test('candles use only known bounds and keep missing observations missing', () => {
  const candles = makeCandles([round(20, 1), round(80, 4)]);
  assert.equal(candles.length, 2); assert.equal(candles[1].open, 120); assert.equal(candles[1].close, 180);
  assert.equal(candles[1].high, 180); assert.equal(candles[1].low, 120);
  assert.equal(makeCandles([], { round: 2, work: 10, projected: 25, endAt: 1000 })[0].provisional, true);
});
test('safe single-round settlements and known zero-work batches are accepted; mixed batches and unsafe events are omitted', () => {
  const event = (from: number, to: number, work: number, safe = true) => ({ type: 'system.settlement_completed', source: { confirmationStatus: safe ? 'safe' : 'pending' }, payload: { previousSettledThroughRound: String(from), settledThroughRound: String(to), workAdded: String(work) } });
  const rounds = parseSettlementHistory({ events: [event(1, 2, 50), event(2, 5, 0), event(5, 7, 80), event(7, 8, 10, false)] }, 0, 600000);
  assert.deepEqual(rounds.map(r => [r.id, r.work]), [[2, 50], [3, 0], [4, 0], [5, 0]]);
  assert.equal(rounds[0].endAt, 1200000);
});
test('core cumulative differences are used only with a matching predecessor', () => {
  const event = (from: number, to: number, work: number, active: number) => ({ eventName: 'BatchSettled', arguments: Object.entries({ previousSettledThroughRound: from, settledThroughRound: to, cumulativeWork: work, activeRoundCount: active }).map(([name, value]) => ({ name, value: String(value) })) });
  const rounds = parseCoreRounds({ events: [event(0, 1, 50, 1), event(1, 2, 80, 1), event(2, 5, 110, 2), event(5, 6, 110, 0)] }, 0, 600000);
  assert.deepEqual(rounds.map(r => [r.id, r.work]), [[2, 30], [6, 0]]);
});
test('malformed and negative settlement values do not create rounds', () => {
  assert.deepEqual(parseSettlementHistory({ events: [{ type: 'system.settlement_completed', source: { confirmationStatus: 'safe' }, payload: { previousSettledThroughRound: '-1', settledThroughRound: 'not-a-round', workAdded: '-20' } }] }, 0, 600000), []);
  assert.deepEqual(parseCoreRounds(null, 0, 600000), []);
});
test('practice is deterministic and separate from the live installation', () => {
  assert.equal(practiceWork(51), practiceWork(51));
  const f = practiceFeed(2, 1000000, 1000000); assert.equal(f.provenance, 'simulated'); assert.equal(f.rounds.at(-1)?.id, 50); assert.equal(f.rounds.at(-1)?.work, practiceWork(49));
});
test('CSV exports complete prediction records without profile names or formulas', () => {
  const a = settleAccount(prediction(), [round(150)], 'fixture-installation', 10, 7000);
  const csv = csvFor(a); assert.equal(csv.split('\n').length, 2); assert.ok(csv.includes('10,long,short,100,150,50,won,50,-50'));
});
