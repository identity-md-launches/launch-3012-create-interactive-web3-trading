import type { Account, GameStore, Player, Position } from './types';
import { STARTING_BALANCE } from './engine';

export const STORE_KEY = 'squeek-terminal.game.v1';
export const emptyAccount = (): Account => ({ balance: STARTING_BALANCE, aiBalance: STARTING_BALANCE, positions: [] });
export const createPlayer = (name: string, id = crypto.randomUUID()): Player => ({ id, name, live: emptyAccount(), practice: emptyAccount() });
export function newStore(): GameStore {
  const player = createPlayer('You');
  return { version: 1, activePlayer: player.id, players: [player], practiceStep: 0 };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const validPosition = (p: Position) => p && typeof p.id === 'string' && typeof p.installation === 'string' &&
  Number.isSafeInteger(p.round) && p.round > 0 && ['long', 'short'].includes(p.direction) && ['long', 'short'].includes(p.aiDirection) &&
  finite(p.stake) && p.stake >= 10 && p.stake <= 250 && finite(p.target) && p.target >= 1 &&
  finite(p.multiplier) && p.multiplier >= 1 && p.multiplier <= 2 && finite(p.aiMultiplier) &&
  finite(p.createdAt) && ['pending', 'won', 'lost', 'void'].includes(p.status) &&
  (p.status === 'pending' || (finite(p.pnl) && finite(p.aiPnl)));
const validAccount = (a: Account) => a && finite(a.balance) && a.balance >= 0 && finite(a.aiBalance) &&
  Array.isArray(a.positions) && a.positions.every(validPosition) && a.positions.filter(p => p.status === 'pending').length <= 1;

export function loadStore(): { store: GameStore; warning: string } {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { store: newStore(), warning: '' };
    const s = JSON.parse(raw) as GameStore;
    if (s.version !== 1 || !Array.isArray(s.players) || !s.players.length || !s.players.every(p =>
      p && typeof p.id === 'string' && typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 24 && validAccount(p.live) && validAccount(p.practice)) ||
      !s.players.some(p => p.id === s.activePlayer) || !Number.isSafeInteger(s.practiceStep) || s.practiceStep < 0) throw new Error('Invalid save');
    return { store: s, warning: '' };
  } catch {
    return { store: newStore(), warning: 'The saved game could not be read. A new local session is open.' };
  }
}

export function saveStore(store: GameStore): boolean {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); return true; } catch { return false; }
}

export function csvFor(account: Account): string {
  const header = 'Round,Direction,AI direction,Target work,Actual work,Stake SQK,Status,PnL SQK,AI PnL SQK';
  return [header, ...account.positions.map(p => [p.round, p.direction, p.aiDirection, p.target, p.work ?? '', p.stake, p.status, p.pnl ?? '', p.aiPnl ?? ''].join(','))].join('\n');
}
