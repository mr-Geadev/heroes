import { WebSocket } from 'ws';

export interface Player {
  id: string;
  name: string;
  ws: WebSocket;
}

export type PlayerInfo = Omit<Player, 'ws'>;

export interface Room {
  code: string;
  players: Player[];
  hostId: string;
  started: boolean;
  gameState?: unknown;
}

export interface GameAction {
  type: string;
  payload: unknown;
}

export type ClientMessage =
  | { type: 'room:create';  payload: { playerName: string } }
  | { type: 'room:join';    payload: { code: string; playerName: string } }
  | { type: 'room:rejoin';  payload: { code: string; playerId: string; playerName: string } }
  | { type: 'room:start';   payload: { state: unknown } }
  | { type: 'game:action';  payload: GameAction };

export type ServerMessage =
  | { type: 'room:created';       payload: { code: string; playerId: string } }
  | { type: 'room:self';          payload: { playerId: string } }
  | { type: 'room:player_joined'; payload: { players: PlayerInfo[] } }
  | { type: 'room:player_left';   payload: { players: PlayerInfo[] } }
  | { type: 'room:error';         payload: { message: string } }
  | { type: 'game:start';         payload: { state: unknown } }
  | { type: 'game:update';        payload: GameAction };
