import { Component, computed, inject } from '@angular/core';
import { WebsocketService } from '../services/websocket.service';
import { generateGameState } from '../game/utils/game.gen';

@Component({
  selector: 'app-waiting-room',
  imports: [],
  templateUrl: './waiting-room.html',
  styleUrl: './waiting-room.css'
})
export class WaitingRoom {
  protected readonly ws = inject(WebsocketService);

  protected readonly empty = computed(() =>
    Array(Math.max(0, 4 - this.ws.players().length)).fill(null)
  );

  protected startGame(): void {
    const state = generateGameState(this.ws.players());
    this.ws.send({ type: 'room:start', payload: { state } });
  }
}
