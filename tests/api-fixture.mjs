// Validation-only API model. Never imported into the website or production export.
export function apiFixture(startAt) {
  const state = { now: startAt, through: 10, stale: false, fail: false };
  const genesis = startAt - 10.5 * 600_000;
  const iso = value => new Date(value).toISOString();
  const work = id => id >= 11 ? 200 : id % 2 ? 80 : 160;
  const base = () => ({ installationId: 'validation-fixture', generatedAt: iso(state.now), status: 'available' });
  return { state, respond(url) {
    const path = new URL(url).pathname;
    if (path === '/v1/status') return { ...base(), measurement: {
      receivedAt: iso(state.now - (state.stale ? 300_000 : 0)), observedAt: iso(state.now), freshness: state.stale ? 'stale' : 'online',
      staleAfterSeconds: 120, provenance: 'simulated', coreStatus: 'ACTIVE', speedMmPerSecond: 400, rpmMilli: 27300, distanceMm: 1000000,
    }, builder: { status: 'available', anchor: { settledThroughRound: String(state.through) }, queued: { openRoundWorkUnits: '50' } } };
    if (path === '/v1/core') return { ...base(), configuration: { genesisTimestamp: String(genesis / 1000), roundDuration: '600' }, core: { settledThroughRound: String(state.through) }, events: [] };
    if (path === '/v1/events') return { ...base(), nextCursor: null, events: Array.from({ length: state.through }, (_, i) => ({ type: 'system.settlement_completed',
      source: { confirmationStatus: 'safe' }, payload: { previousSettledThroughRound: String(i), settledThroughRound: String(i + 1), workAdded: String(work(i + 1)) } })) };
    if (path === '/v1/measurement/stats') return { ...base(), lifetime: { acceptedWorkUnits: '1000', observedDistanceMm: '878000' }, rounds: { medianActiveWork: '120' } };
    throw new Error(`Unknown fixture path ${path}`);
  } };
}
