import { WebSocket } from 'ws';
import {
  ClientMessage,
  Player,
  Room,
  ServerMessage,
} from './types';
import {
  createRoom,
  findRoomByWs,
  joinRoom,
  rejoinRoom,
  startRoom,
  toPlayerInfo,
} from './room-manager';

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function broadcast(players: Player[], msg: ServerMessage): void {
  players.filter(p => p.ws).forEach(p => send(p.ws, msg));
}

function broadcastOthers(players: Player[], senderWs: WebSocket, msg: ServerMessage): void {
  players.filter(p => p.ws && p.ws !== senderWs).forEach(p => send(p.ws, msg));
}

export function handleMessage(
  ws: WebSocket,
  raw: string,
  rooms: Map<string, Room>
): void {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw) as ClientMessage;
  } catch {
    send(ws, { type: 'room:error', payload: { message: 'Invalid JSON' } });
    return;
  }

  switch (msg.type) {
    case 'room:create': {
      const { room, player } = createRoom(ws, msg.payload.playerName, rooms);
      send(ws, { type: 'room:created', payload: { code: room.code, playerId: player.id } });
      send(ws, { type: 'room:player_joined', payload: { players: room.players.map(toPlayerInfo) } });
      break;
    }

    case 'room:join': {
      const result = joinRoom(ws, msg.payload.code, msg.payload.playerName, rooms);
      if ('error' in result) {
        send(ws, { type: 'room:error', payload: { message: result.error } });
        return;
      }
      const { room, player } = result;
      // Tell the joining player their own ID
      send(ws, { type: 'room:self', payload: { playerId: player.id } });
      broadcast(room.players, {
        type: 'room:player_joined',
        payload: { players: room.players.map(toPlayerInfo) },
      });
      break;
    }

    case 'room:rejoin': {
      const result = rejoinRoom(ws, msg.payload.code, msg.payload.playerId, msg.payload.playerName, rooms);
      if ('error' in result) {
        send(ws, { type: 'room:error', payload: { message: result.error } });
        return;
      }
      const { room, player } = result;
      send(ws, { type: 'room:self', payload: { playerId: player.id } });
      if (room.gameState) {
        send(ws, { type: 'game:update', payload: { type: 'state:update', payload: room.gameState } });
      }
      broadcast(room.players, {
        type: 'room:player_joined',
        payload: { players: room.players.map(toPlayerInfo) },
      });
      break;
    }

    case 'room:start': {
      const found = findRoomByWs(ws, rooms);
      if (!found) {
        send(ws, { type: 'room:error', payload: { message: 'Not in a room' } });
        return;
      }
      const { room, player } = found;
      if (player.id !== room.hostId) {
        send(ws, { type: 'room:error', payload: { message: 'Only the host can start the game' } });
        return;
      }
      startRoom(room.code, rooms);
      room.gameState = msg.payload.state;
      broadcast(room.players, { type: 'game:start', payload: { state: msg.payload.state } });
      break;
    }

    case 'game:action': {
      const found = findRoomByWs(ws, rooms);
      if (!found) return;
      if (msg.payload.type === 'state:update') {
        found.room.gameState = msg.payload.payload;
      }
      broadcastOthers(found.room.players, ws, {
        type: 'game:update',
        payload: msg.payload,
      });
      break;
    }

    default: {
      send(ws, { type: 'room:error', payload: { message: 'Unknown message type' } });
    }
  }
}
