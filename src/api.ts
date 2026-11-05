import type { Feed, Round } from './types';

export const API = 'https://api.squeekchain.com/v1';
type Obj = Record<string, unknown>;
const object = (v: unknown): Obj => typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Obj : {};
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const number = (v: unknown, fallback = 0): number => {
  if ((typeof v !== 'number' && typeof v !== 'string') || v === '') return fallback;
  const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const stamp = (v: unknown): number => typeof v === 'string' ? Date.parse(v) : NaN;
let statsCache: { at: number; installation: string; data: Obj } | null = null;
let historyCache: { through: number; installation: string; rounds: Round[] } | null = null;

async function get(path: string, signal?: AbortSignal): Promise<Obj> {
  const timeout = AbortSignal.timeout(12_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(`${API}${path}`, { signal: combined, credentials: 'omit', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(response.status === 429 ? 'API rate limit reached. Try refreshing shortly.' : `Squeekchain API returned ${response.status}. Try refreshing.`);
  const data = object(await response.json());
  if (data.status === 'unavailable') throw new Error('Squeekchain is rebuilding its data. Try refreshing shortly.');
  return data;
}

export function parseSettlementHistory(data: unknown, genesis: number, duration: number): Round[] {
  const rounds = new Map<number, Round>();
  for (const value of array(object(data).events)) {
    const event = object(value);
    if (event.type !== 'system.settlement_completed' || object(event.source).confirmationStatus !== 'safe') continue;
    const p = object(event.payload);
    const previous = number(p.previousSettledThroughRound, -1);
    const through = number(p.settledThroughRound, -1);
    const work = number(p.workAdded, -1);
    if (!Number.isSafeInteger(previous) || !Number.isSafeInteger(through) || through <= previous || through - previous > 1000 || work < 0) continue;
    if (through - previous === 1 || work === 0) {
      for (let id = previous + 1; id <= through; id++) rounds.set(id, { id, work: through - previous === 1 ? work : 0, endAt: genesis + id * duration, source: 'confirmed' });
    }
  }
  return [...rounds.values()].sort((a, b) => a.id - b.id);
}

export function parseCoreRounds(data: unknown, genesis: number, duration: number): Round[] {
  const batches = array(object(data).events).map(object).filter(e => e.eventName === 'BatchSettled').map(e => {
    const args = Object.fromEntries(array(e.arguments).map(object).map(a => [String(a.name), a.value]));
    return { through: number(args.settledThroughRound, -1), previous: number(args.previousSettledThroughRound, -1),
      cumulative: number(args.cumulativeWork, -1), active: number(args.activeRoundCount, -1) };
  }).sort((a, b) => a.through - b.through);
  const rounds: Round[] = [];
  batches.forEach((b, i) => {
    const prior = batches[i - 1];
    const work = b.active === 0 ? 0 : prior && prior.through === b.previous ? b.cumulative - prior.cumulative : -1;
    const count = b.through - b.previous;
    if (work < 0 || count < 1 || count > 1000 || b.previous < 0 || (count > 1 && work !== 0)) return;
    for (let id = b.previous + 1; id <= b.through; id++) rounds.push({ id, work: count === 1 ? work : 0, endAt: genesis + id * duration, source: 'confirmed' });
  });
  return rounds;
}

async function loadHistory(installation: string, genesis: number, duration: number, required: number, signal?: AbortSignal): Promise<Round[]> {
  const budget = AbortSignal.timeout(8_000);
  const historySignal = signal ? AbortSignal.any([signal, budget]) : budget;
  let page = await get('/events?category=protocol&limit=100', historySignal);
  const rounds = new Map<number, Round>();
  for (let count = 0; count < 4; count++) {
    if (page.installationId !== installation) break;
    for (const round of parseSettlementHistory(page, genesis, duration)) rounds.set(round.id, round);
    if (rounds.size >= required || typeof page.nextCursor !== 'string' || !page.nextCursor || page.nextCursor.length > 4096) break;
    try { page = await get(`/events?category=protocol&limit=100&cursor=${encodeURIComponent(page.nextCursor)}`, historySignal); }
    catch { break; } // Keep the confirmed observations already loaded if another page fails.
  }
  return [...rounds.values()].sort((a, b) => a.id - b.id);
}

export async function fetchFeed(previous?: Feed | null, signal?: AbortSignal): Promise<Feed> {
  const [status, core] = await Promise.all([get('/status', signal), get('/core', signal)]);
  const installation = String(status.installationId ?? '');
  if (!installation || installation !== core.installationId) throw new Error('API snapshots are out of sync. Refresh to retry.');
  const measurement = object(status.measurement);
  const config = object(core.configuration);
  const state = object(core.core);
  const builder = object(status.builder);
  const anchor = object(builder.anchor);
  const receivedAt = stamp(measurement.receivedAt);
  const generatedAt = stamp(status.generatedAt);
  const genesis = number(config.genesisTimestamp) * 1000;
  const duration = number(config.roundDuration) * 1000;
  if (!Number.isFinite(receivedAt) || !Number.isFinite(generatedAt) || !genesis || duration < 1000 || builder.status !== 'available' ||
    typeof measurement.coreStatus !== 'string' || !Number.isFinite(Number(measurement.speedMmPerSecond)) || !Number.isFinite(Number(measurement.distanceMm))) {
    throw new Error('The API has no usable wheel reading yet. Refresh to retry.');
  }
  // Require agreement on the safe frontier before accepting a live game result.
  const settledThrough = Math.min(number(state.settledThroughRound), number(anchor.settledThroughRound));
  const now = Date.now();
  const needHistory = !historyCache || historyCache.installation !== installation || historyCache.through !== settledThrough;
  const needStats = !statsCache || statsCache.installation !== installation || now - statsCache.at > 300_000;
  const extra = await Promise.allSettled([
    needHistory ? loadHistory(installation, genesis, duration, previous?.installation === installation && previous.rounds.length >= 144 ? 1 : 144, signal) : Promise.resolve(null),
    needStats ? get('/measurement/stats?range=7d', signal) : Promise.resolve(null),
  ]);
  if (extra[0].status === 'fulfilled' && extra[0].value) {
    historyCache = { installation, through: settledThrough, rounds: extra[0].value };
  }
  if (extra[1].status === 'fulfilled' && extra[1].value?.installationId === installation) statsCache = { installation, at: now, data: extra[1].value };
  const merged = new Map<number, Round>();
  const old = previous?.installation === installation ? previous.rounds : [];
  const cached = historyCache?.installation === installation ? historyCache.rounds : [];
  for (const r of [...old, ...cached, ...parseCoreRounds(core, genesis, duration)]) if (r.id <= settledThrough) merged.set(r.id, r);
  const stats = statsCache?.installation === installation ? statsCache.data : {};
  const lifetime = object(stats.lifetime);
  const units = number(lifetime.acceptedWorkUnits);
  const observedDistance = number(lifetime.observedDistanceMm);
  const rounds = [...merged.values()].sort((a, b) => a.id - b.id).slice(-500);
  return {
    installation, generatedAt, observedAt: stamp(measurement.observedAt), receivedAt, fetchedAt: now,
    staleAfter: number(measurement.staleAfterSeconds, 120), freshness: String(measurement.freshness ?? 'unavailable'), provenance: String(measurement.provenance ?? 'unknown'),
    wheelStatus: measurement.coreStatus, speed: number(measurement.speedMmPerSecond) / 1000,
    rpm: number(measurement.rpmMilli) / 1000, distance: number(measurement.distanceMm) / 1000,
    openWork: number(object(builder.queued).openRoundWorkUnits), genesis, duration, settledThrough, rounds,
    metersPerWork: units > 0 && observedDistance > 0 ? observedDistance / 1000 / units : null,
    historicalMedian: number(object(stats.rounds).medianActiveWork),
  };
}
