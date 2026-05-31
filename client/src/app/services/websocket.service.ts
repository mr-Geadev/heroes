import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ClientMessage, GameState, PlayerInfo, ServerMessage } from '../types';

const SESSION_KEY = 'heroes_session';

interface SessionData {
  roomCode: string;
  playerId: string;
  playerName: string;
  isHost: boolean;
  players: PlayerInfo[];
  gameState: GameState | null;
  route: 'room' | 'game';
}

@Injectable({ providedIn: 'root' })
export class WebsocketService {
  private readonly router = inject(Router);

  readonly players   = signal<PlayerInfo[]>([]);
  readonly roomCode  = signal('');
  readonly playerId  = signal('');
  readonly playerName = signal('');
  readonly isHost    = signal(false);
  readonly gameState = signal<GameState | null>(null);
  readonly error     = signal('');

  private ws: WebSocket | null = null;
  private pending: string[] = [];

  constructor() {
    this.tryRestoreSession();
  }

  connect(): void {
    if (this.ws) return;
    this.ws = new WebSocket('ws://localhost:3001');

    this.ws.onopen = () => {
      this.pending.forEach(m => this.ws!.send(m));
      this.pending = [];
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        this.dispatch(JSON.parse(event.data as string) as ServerMessage);
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onerror = () => {
      this.error.set('Не удалось подключиться к серверу');
    };
  }

  send(msg: ClientMessage): void {
    const raw = JSON.stringify(msg);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(raw);
    } else {
      this.pending.push(raw);
    }
  }

  updateGameState(state: GameState): void {
    this.gameState.set(state);
    this.saveSession('game');
    this.send({ type: 'game:action', payload: { type: 'state:update', payload: state } });
  }

  private tryRestoreSession(): void {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;

    let session: SessionData;
    try {
      session = JSON.parse(raw) as SessionData;
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }

    this.roomCode.set(session.roomCode);
    this.playerId.set(session.playerId);
    this.playerName.set(session.playerName);
    this.isHost.set(session.isHost);
    this.players.set(session.players);

    if (session.gameState) {
      this.gameState.set(session.gameState);
    }

    this.connect();
    this.send({
      type: 'room:rejoin',
      payload: {
        code: session.roomCode,
        playerId: session.playerId,
        playerName: session.playerName,
      },
    });

    this.router.navigate(['/' + session.route]);
  }

  private saveSession(route: 'room' | 'game'): void {
    const session: SessionData = {
      roomCode: this.roomCode(),
      playerId: this.playerId(),
      playerName: this.playerName(),
      isHost: this.isHost(),
      players: this.players(),
      gameState: this.gameState(),
      route,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  private dispatch(msg: ServerMessage): void {
    switch (msg.type) {
      case 'room:created':
        this.roomCode.set(msg.payload.code);
        this.playerId.set(msg.payload.playerId);
        this.isHost.set(true);
        this.saveSession('room');
        this.router.navigate(['/room']);
        break;

      case 'room:self':
        this.playerId.set(msg.payload.playerId);
        break;

      case 'room:player_joined': {
        this.players.set(msg.payload.players);
        const inGame = this.gameState() !== null;
        if (!inGame && !this.isHost()) {
          this.router.navigate(['/room']);
        }
        this.saveSession(inGame ? 'game' : 'room');
        break;
      }

      case 'room:player_left':
        this.players.set(msg.payload.players);
        this.saveSession(this.router.url.startsWith('/game') ? 'game' : 'room');
        break;

      case 'room:error':
        this.error.set(msg.payload.message);
        break;

      case 'game:start':
        this.gameState.set(msg.payload.state as GameState);
        this.saveSession('game');
        this.router.navigate(['/game']);
        break;

      case 'game:update': {
        const action = msg.payload as { type: string; payload: unknown };
        if (action.type === 'state:update') {
          const incoming = action.payload as GameState;
          const current = this.gameState();
          // Merge initRolls so simultaneous rolls don't overwrite each other
          if (current?.phase === 'init_roll' && incoming.phase === 'init_roll') {
            incoming.initRolls = { ...(current.initRolls ?? {}), ...(incoming.initRolls ?? {}) };
          }
          this.gameState.set(incoming);
          this.saveSession('game');
        }
        break;
      }
    }
  }
}