import './ui/styles.css';
import { GameRenderer } from './render/GameRenderer';
import { InputManager } from './game/Input';
import { GameController, Phase } from './game/GameController';
import { NetClient } from './net/NetClient';
import { UI } from './ui/UI';
import { AIController, Difficulty } from './game/AI';
import { FIXED_DT, Side } from './game/constants';
import { Simulation } from './game/Simulation';

const app = document.getElementById('app')!;

// --- Core singletons ----------------------------------------------------
let renderer: GameRenderer;
let controller: GameController | null = null;

const input = new InputManager();

// Forward declaration so callbacks can reference `ui`.
let ui: UI;

type Mode = 'cpu' | 'host' | 'guest';
let mode: Mode = 'cpu';
let online = false;
let playerSide: Side = Side.Left;
let lastScore: [number, number] = [0, 0];
let inMatchOver = false;
let names = { left: 'Du', right: 'CPU' };
let attractActive = true;

const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// --- Net client ---------------------------------------------------------
const net = new NetClient({
  onCreated: (code) => {
    ui.showLobbyHost(code);
  },
  onJoined: (_code, peerName) => {
    // We're the guest; the host's snapshots will start arriving.
    names = { left: peerName || 'Gegner', right: getMyName() };
    startGame('guest');
  },
  onPeerJoined: (peerName) => {
    // We're the host; opponent connected — kick off the match.
    names = { left: getMyName(), right: peerName || 'Gegner' };
    startGame('host');
  },
  onPeerLeft: () => {
    ui.toast('Gegenspieler hat die Lobby verlassen.');
    endToMenu();
  },
  onInput: (i) => controller?.receiveRemoteInput(i),
  onState: (snap) => controller?.receiveSnapshot(snap, performance.now() / 1000),
  onRematch: () => {
    // Guest requested a rematch -> host resets the match.
    if (mode === 'host') controller?.requestRematch();
  },
  onError: (msg) => {
    ui.setJoinStatus(msg, true);
    ui.toast(msg);
  },
  onPing: (ms) => ui.updatePing(ms),
});

function getMyName(): string {
  return localStorage.getItem('bv_name') || 'Blobby';
}

// --- Game lifecycle -----------------------------------------------------
function ensureRenderer(): void {
  if (!renderer) {
    renderer = new GameRenderer(ui.canvasContainer);
  }
}

function buildController(): GameController {
  ensureRenderer();
  return new GameController(renderer, input, online ? net : null, {
    onScore: (l, r) => {
      lastScore = [l, r];
      ui.updateScore(l, r);
    },
    onPhase: handlePhase,
    onPing: (ms) => ui.updatePing(ms),
  });
}

function handlePhase(phase: Phase, info?: { winner?: Side; countdown?: number; pointWinner?: Side }): void {
  switch (phase) {
    case 'countdown':
      ui.showCountdown(info?.countdown ?? 0);
      break;
    case 'rally':
      if (inMatchOver) {
        // Online rematch resumed.
        inMatchOver = false;
        ui.hideOverlay();
        ui.showHud(names.left, names.right, online);
      }
      ui.hideBanner();
      break;
    case 'point': {
      const w = info?.pointWinner;
      if (w !== undefined) {
        const mine = w === playerSide;
        ui.showPoint(mine ? 'Punkt für dich! 🎉' : 'Punkt für Gegner', UI.sideColor(w));
      }
      break;
    }
    case 'matchover': {
      const winner = info?.winner ?? Side.Left;
      inMatchOver = true;
      input.setEnabled(false);
      ui.enableTouch(false);
      ui.showMatchOver(winner === playerSide, lastScore[0], lastScore[1], online);
      break;
    }
  }
}

function startGame(m: Mode): void {
  mode = m;
  online = m !== 'cpu';
  playerSide = m === 'guest' ? Side.Right : Side.Left;
  inMatchOver = false;
  lastScore = [0, 0];
  attractActive = false;

  controller?.stop();
  controller = buildController();

  ui.hideOverlay();
  ui.showHud(names.left, names.right, online);
  input.setEnabled(true);
  ui.enableTouch(isTouch);

  if (m === 'cpu') controller.startCpu(currentDifficulty);
  else if (m === 'host') controller.startHost();
  else controller.startGuest();
}

function endToMenu(): void {
  controller?.stop();
  controller = null;
  net.leave();
  online = false;
  inMatchOver = false;
  input.setEnabled(false);
  ui.enableTouch(false);
  ui.hideHud();
  ui.showMain();
  attractActive = true;
}

let currentDifficulty: Difficulty = 'medium';

// --- UI wiring ----------------------------------------------------------
ui = new UI(app, {
  onPlayCpu: (difficulty) => {
    currentDifficulty = difficulty;
    online = false;
    names = { left: 'Du', right: `CPU · ${difficulty}` };
    startGame('cpu');
  },
  onCreateLobby: (name) => {
    localStorage.setItem('bv_name', name);
    net.create(name).catch(() => ui.toast('Server nicht erreichbar.'));
  },
  onJoinLobby: (code, name) => {
    localStorage.setItem('bv_name', name);
    ui.setJoinStatus('Verbinde…');
    net.join(code, name).catch(() => ui.setJoinStatus('Server nicht erreichbar.', true));
  },
  onCancelLobby: () => {
    net.leave();
    ui.showOnline();
  },
  onRematch: () => {
    if (mode === 'cpu') {
      controller?.requestRematch();
      input.setEnabled(true);
      ui.enableTouch(isTouch);
      inMatchOver = false;
      ui.hideOverlay();
      ui.showHud(names.left, names.right, online);
    } else if (mode === 'host') {
      controller?.requestRematch();
      input.setEnabled(true);
      ui.enableTouch(isTouch);
      inMatchOver = false;
      ui.hideOverlay();
      ui.showHud(names.left, names.right, online);
    } else {
      // Guest: ask the host for a rematch and wait.
      net.sendRematch();
      input.setEnabled(true);
      ui.enableTouch(isTouch);
      ui.toast('Revanche angefragt — warte auf Host…');
    }
  },
  onExitToMenu: () => endToMenu(),
  onTouch: (i) => input.setTouch(i),
});

// --- Attract mode: two CPUs rally behind the menu for a lively backdrop --
ensureRenderer();
const attractSim = new Simulation(Side.Left);
const attractAI: [AIController, AIController] = [
  new AIController(Side.Left, 'medium'),
  new AIController(Side.Right, 'medium'),
];

function attractLoop(): void {
  requestAnimationFrame(attractLoop);
  if (!attractActive) return;
  // A few fixed steps per frame so the rally runs at full speed.
  for (let i = 0; i < 4; i++) {
    const l = attractAI[0].update(attractSim, FIXED_DT);
    const r = attractAI[1].update(attractSim, FIXED_DT);
    attractSim.step(FIXED_DT, l, r);
    if (attractSim.contacts.length) renderer.handleContacts(attractSim.contacts);
    if (attractSim.pointWinner !== null) {
      attractSim.resetForServe(attractSim.pointWinner === Side.Left ? Side.Right : Side.Left);
    }
  }
  renderer.sync(attractSim.state, 1 / 30);
  renderer.render();
}
attractLoop();

// --- Deep-link: ?lobby=CODE auto-opens the join screen ------------------
const params = new URLSearchParams(window.location.search);
const lobbyParam = params.get('lobby');
if (lobbyParam) {
  ui.showJoin(lobbyParam.toUpperCase().slice(0, 4));
}
