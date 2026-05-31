import { Routes } from '@angular/router';
import { Lobby } from './lobby/lobby';
import { WaitingRoom } from './waiting-room/waiting-room';
import { Game } from './game/game';

export const routes: Routes = [
  { path: '',      redirectTo: 'lobby', pathMatch: 'full' },
  { path: 'lobby', component: Lobby },
  { path: 'room',  component: WaitingRoom },
  { path: 'game',  component: Game },
];
