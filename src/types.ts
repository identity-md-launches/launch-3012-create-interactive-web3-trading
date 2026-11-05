export type Direction = 'long' | 'short';
export type Mode = 'live' | 'practice';

export interface Round {
  id: number;
  work: number;
  endAt: number;
  source: 'confirmed' | 'practice';
}

export interface Candle {
  time: number;
  round: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  provisional?: boolean;
}

export interface Feed {
  installation: string;
  generatedAt: number;
  observedAt: number;
  receivedAt: number;
  fetchedAt: number;
  staleAfter: number;
  freshness: string;
  provenance: string;
  wheelStatus: string;
  speed: number;
  rpm: number;
  distance: number;
  openWork: number;
  genesis: number;
  duration: number;
  settledThrough: number;
  rounds: Round[];
  metersPerWork: number | null;
  historicalMedian: number;
}

export interface Signal {
  id: 'momentum' | 'reclaim' | 'reversal';
  name: string;
  state: 'active' | 'watching' | 'insufficient';
  direction: Direction | null;
  detail: string;
}

export interface Forecast {
  direction: Direction;
  strength: number;
  target: number;
  reason: string;
}

export interface Position {
  id: string;
  installation: string;
  round: number;
  direction: Direction;
  aiDirection: Direction;
  aiStrength: number;
  stake: number;
  target: number;
  multiplier: number;
  aiMultiplier: number;
  createdAt: number;
  status: 'pending' | 'won' | 'lost' | 'void';
  work?: number;
  pnl?: number;
  aiPnl?: number;
  settledAt?: number;
  note?: string;
}

export interface Account {
  balance: number;
  aiBalance: number;
  positions: Position[];
}

export interface Player {
  id: string;
  name: string;
  live: Account;
  practice: Account;
}

export interface GameStore {
  version: 1;
  activePlayer: string;
  players: Player[];
  practiceStep: number;
}
