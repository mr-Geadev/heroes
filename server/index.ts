import http from 'http';
import { WebSocketServer } from 'ws';
import { Room } from './types';
import { broadcast, handleMessage } from './message-handler';
import { removePlayerFromRoom, toPlayerInfo } from './room-manager';

const PORT = process.env['PORT'] ? parseInt(process.env['PORT']) : 3001;

const rooms = new Map<string, Room>();

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server running\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    handleMessage(ws, data.toString(), rooms);
  });

  ws.on('close', () => {
    const { room, leftPlayer } = removePlayerFromRoom(ws, rooms);
    if (room && leftPlayer) {
      broadcast(room.players, {
        type: 'room:player_left',
        payload: { players: room.players.map(toPlayerInfo) },
      });
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on ws://localhost:${PORT}`);
});
