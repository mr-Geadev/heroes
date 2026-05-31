import { randomUUID } from 'crypto';
import { WebSocket } from 'ws';
import { Player, PlayerInfo, Room } from './types';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(rooms: Map<string, Room>): string {
  let code: string;
  do {
    code = Array.from({ length: 6 }, () =>
      ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

export function toPlayerInfo(p: Player): PlayerInfo {
  return { id: p.id, name: p.name };
}

export function createRoom(
  ws: WebSocket,
  playerName: string,
  rooms: Map<string, Room>
): { room: Room; player: Player } {
  const player: Player = { id: randomUUID(), name: playerName, ws };
  const room: Room = {
    code: generateCode(rooms),
    players: [player],
    hostId: player.id,
    started: false,
  };
  rooms.set(room.code, room);
  return { room, player };
}

export function joinRoom(
  ws: WebSocket,
  code: string,
  playerName: string,
  rooms: Map<string, Room>
): { room: Room; player: Player } | { error: string } {
  const room = rooms.get(code);
  if (!room) return { error: `Room "${code}" not found` };
  if (room.players.length >= 4) return { error: 'Room is full' };

  const player: Player = { id: randomUUID(), name: playerName, ws };
  room.players.push(player);
  return { room, player };
}

export function startRoom(code: string, rooms: Map<string, Room>): Room | null {
  const room = rooms.get(code);
  if (!room) return null;
  room.started = true;
  return room;
}

export function findRoomByWs(
  ws: WebSocket,
  rooms: Map<string, Room>
): { room: Room; player: Player } | null {
  for (const room of rooms.values()) {
    const player = room.players.find(p => p.ws === ws);
    if (player) return { room, player };
  }
  return null;
}

export function rejoinRoom(
  ws: WebSocket,
  code: string,
  playerId: string,
  playerName: string,
  rooms: Map<string, Room>
): { room: Room; player: Player } | { error: string } {
  const room = rooms.get(code);
  if (!room) return { error: `Room "${code}" not found` };

  const existing = room.players.find(p => p.id === playerId);
  if (existing) {
    existing.ws = ws;
    delete (existing as any).disconnected;
    return { room, player: existing };
  }

  // New player slot (shouldn't normally happen since we keep players on disconnect)
  const activeCount = room.players.filter(p => !(p as any).disconnected).length;
  if (activeCount >= 4) return { error: 'Room is full' };
  const player: Player = { id: playerId, name: playerName, ws };
  room.players.push(player);
  return { room, player };
}

export function removePlayerFromRoom(
  ws: WebSocket,
  rooms: Map<string, Room>
): { room: Room | null; leftPlayer: Player | null } {
  const found = findRoomByWs(ws, rooms);
  if (!found) return { room: null, leftPlayer: null };

  const { room, player: leftPlayer } = found;
  // Mark player as disconnected but keep them in the room so they can rejoin.
  // This prevents the room from being deleted when all players temporarily disconnect.
  (leftPlayer as any).disconnected = true;
  leftPlayer.ws = null as any;

  const activePlayers = room.players.filter(p => !(p as any).disconnected);

  if (room.hostId === leftPlayer.id && activePlayers.length > 0) {
    room.hostId = activePlayers[0].id;
  }

  return { room, leftPlayer };
}
