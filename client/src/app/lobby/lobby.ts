import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WebsocketService } from '../services/websocket.service';

@Component({
  selector: 'app-lobby',
  imports: [FormsModule],
  templateUrl: './lobby.html',
  styleUrl: './lobby.css'
})
export class Lobby {
  protected readonly ws = inject(WebsocketService);

  protected createName = '';
  protected joinCode = '';
  protected joinName = '';

  protected createRoom(): void {
    this.ws.error.set('');
    this.ws.playerName.set(this.createName.trim());
    this.ws.connect();
    this.ws.send({ type: 'room:create', payload: { playerName: this.createName.trim() } });
  }

  protected joinRoom(): void {
    this.ws.error.set('');
    this.ws.playerName.set(this.joinName.trim());
    this.ws.roomCode.set(this.joinCode.trim().toUpperCase());
    this.ws.connect();
    this.ws.send({
      type: 'room:join',
      payload: { code: this.joinCode.trim().toUpperCase(), playerName: this.joinName.trim() }
    });
  }
}
