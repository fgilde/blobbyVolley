import { Difficulty } from '../game/AI';
import { Side } from '../game/constants';

export interface UICallbacks {
  onPlayCpu: (difficulty: Difficulty) => void;
  onCreateLobby: (name: string) => void;
  onJoinLobby: (code: string, name: string) => void;
  onCancelLobby: () => void;
  onRematch: () => void;
  onExitToMenu: () => void;
  onTouch: (input: { left?: boolean; right?: boolean; jump?: boolean }) => void;
}

type Screen =
  | 'main'
  | 'difficulty'
  | 'online'
  | 'lobby-host'
  | 'lobby-join'
  | 'controls'
  | 'matchover'
  | 'none';

const DIFFS: { id: Difficulty; name: string; emoji: string; desc: string }[] = [
  { id: 'easy', name: 'Locker', emoji: '🌴', desc: 'Entspannt — perfekt zum Reinkommen' },
  { id: 'medium', name: 'Solide', emoji: '🏐', desc: 'Fairer Gegner mit echtem Spielwitz' },
  { id: 'hard', name: 'Profi', emoji: '🔥', desc: 'Schnell, präzise, gnadenlos platziert' },
  { id: 'insane', name: 'Wahnsinn', emoji: '👽', desc: 'Übermenschliche Reflexe. Viel Glück.' },
];

const NAME_KEY = 'bv_name';

export class UI {
  readonly canvasContainer: HTMLElement;
  private overlay!: HTMLElement;
  private hud!: HTMLElement;
  private banner!: HTMLElement;
  private touch!: HTMLElement;
  private toastEl!: HTMLElement;

  private leftScoreEl!: HTMLElement;
  private rightScoreEl!: HTMLElement;
  private leftNameEl!: HTMLElement;
  private rightNameEl!: HTMLElement;
  private pingPill!: HTMLElement;
  private pingText!: HTMLElement;

  private selectedDiff: Difficulty = 'medium';
  private toastTimer = 0;

  constructor(
    app: HTMLElement,
    private cb: UICallbacks,
  ) {
    app.innerHTML = `
      <div class="backdrop"></div>
      <div class="canvas-container" style="position:absolute;inset:0;z-index:1;"></div>
      <div class="hud hidden" id="hud"></div>
      <div class="banner hidden" id="banner"></div>
      <div class="touch-controls" id="touch"></div>
      <div class="overlay active" id="overlay"></div>
      <div class="toast" id="toast"></div>
    `;
    this.canvasContainer = app.querySelector('.canvas-container') as HTMLElement;
    this.overlay = app.querySelector('#overlay') as HTMLElement;
    this.hud = app.querySelector('#hud') as HTMLElement;
    this.banner = app.querySelector('#banner') as HTMLElement;
    this.touch = app.querySelector('#touch') as HTMLElement;
    this.toastEl = app.querySelector('#toast') as HTMLElement;

    this.buildHud();
    this.buildTouch();
    this.showMain();
  }

  private getName(): string {
    return localStorage.getItem(NAME_KEY) || '';
  }
  private setName(n: string): void {
    localStorage.setItem(NAME_KEY, n);
  }

  // --- Screen routing ----------------------------------------------------
  private setScreen(html: string, screen: Screen): void {
    if (screen === 'none') {
      this.overlay.classList.remove('active');
      this.overlay.innerHTML = '';
      return;
    }
    this.overlay.classList.add('active');
    this.overlay.innerHTML = `<div class="panel" data-screen="${screen}">${html}</div>`;
  }

  showMain(): void {
    this.hideHud();
    this.setScreen(
      `
      <div class="logo"><span class="b1">Blobby</span> <span class="b2">Volley</span></div>
      <div class="tagline">Der klassische Strand-Klassiker — neu in 3D.</div>
      <button class="btn primary" data-act="cpu"><span class="emoji">🤖</span> Gegen CPU spielen</button>
      <button class="btn" data-act="online"><span class="emoji">🌐</span> Online Multiplayer</button>
      <button class="btn ghost" data-act="controls"><span class="emoji">⌨️</span> Steuerung</button>
    `,
      'main',
    );
    this.bind('[data-act="cpu"]', () => this.showDifficulty());
    this.bind('[data-act="online"]', () => this.showOnline());
    this.bind('[data-act="controls"]', () => this.showControls());
  }

  showDifficulty(): void {
    const cards = DIFFS.map(
      (d) => `
      <div class="diff-card ${d.id === this.selectedDiff ? 'selected' : ''}" data-diff="${d.id}">
        <div class="d-emoji">${d.emoji}</div>
        <div class="d-name">${d.name}</div>
        <div class="d-desc">${d.desc}</div>
      </div>`,
    ).join('');
    this.setScreen(
      `
      <div class="logo" style="font-size:34px;">Schwierigkeit</div>
      <div class="tagline">Wie hart darf's werden?</div>
      <div class="diff-grid">${cards}</div>
      <button class="btn primary" data-act="start" style="margin-top:22px;">Los geht's ▶</button>
      <div class="back-link" data-act="back">← Zurück</div>
    `,
      'difficulty',
    );
    this.overlay.querySelectorAll('.diff-card').forEach((el) => {
      el.addEventListener('click', () => {
        this.selectedDiff = (el as HTMLElement).dataset.diff as Difficulty;
        this.overlay.querySelectorAll('.diff-card').forEach((c) => c.classList.remove('selected'));
        el.classList.add('selected');
      });
    });
    this.bind('[data-act="start"]', () => this.cb.onPlayCpu(this.selectedDiff));
    this.bind('[data-act="back"]', () => this.showMain());
  }

  showOnline(): void {
    const name = this.getName();
    this.setScreen(
      `
      <div class="logo" style="font-size:34px;">Online spielen</div>
      <div class="tagline">Erstelle eine Lobby oder tritt einem Freund bei.</div>
      <div class="field">
        <label>Dein Name</label>
        <input class="input" id="name-input" maxlength="20" placeholder="Blobby" value="${this.escape(name)}" />
      </div>
      <button class="btn primary" data-act="create"><span class="emoji">✨</span> Lobby erstellen</button>
      <button class="btn" data-act="join"><span class="emoji">🔑</span> Mit Code beitreten</button>
      <div class="back-link" data-act="back">← Zurück</div>
    `,
      'online',
    );
    this.bind('[data-act="create"]', () => {
      const n = this.readName();
      this.cb.onCreateLobby(n);
    });
    this.bind('[data-act="join"]', () => this.showJoin());
    this.bind('[data-act="back"]', () => this.showMain());
  }

  showJoin(prefill = ''): void {
    const name = this.getName();
    this.setScreen(
      `
      <div class="logo" style="font-size:34px;">Lobby beitreten</div>
      <div class="tagline">Gib den 4-stelligen Code deines Freundes ein.</div>
      <div class="field">
        <label>Dein Name</label>
        <input class="input" id="name-input" maxlength="20" placeholder="Blobby" value="${this.escape(name)}" />
      </div>
      <div class="field">
        <label>Lobby-Code</label>
        <input class="input code" id="code-input" maxlength="4" placeholder="····" value="${this.escape(prefill)}" />
      </div>
      <div class="status" id="join-status"></div>
      <button class="btn primary" data-act="join"><span class="emoji">🚀</span> Beitreten</button>
      <div class="back-link" data-act="back">← Zurück</div>
    `,
      'lobby-join',
    );
    const codeInput = this.overlay.querySelector('#code-input') as HTMLInputElement;
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    codeInput.focus();
    const doJoin = () => {
      const code = codeInput.value.trim();
      if (code.length < 4) {
        this.setJoinStatus('Bitte vollständigen Code eingeben.', true);
        return;
      }
      this.cb.onJoinLobby(code, this.readName());
    };
    this.bind('[data-act="join"]', doJoin);
    codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doJoin();
    });
    this.bind('[data-act="back"]', () => this.showOnline());
  }

  setJoinStatus(msg: string, error = false): void {
    const el = this.overlay.querySelector('#join-status') as HTMLElement | null;
    if (el) {
      el.textContent = msg;
      el.classList.toggle('error', error);
    }
  }

  /** Host waiting screen with code + share link. */
  showLobbyHost(code: string): void {
    const link = `${window.location.origin}${window.location.pathname}?lobby=${code}`;
    this.setScreen(
      `
      <div class="logo" style="font-size:30px;">Lobby bereit!</div>
      <div class="tagline">Teile diesen Code oder Link mit deinem Gegner.</div>
      <div class="code-box">
        <div class="code-display">${code}</div>
      </div>
      <div class="copy-link">
        <input class="input" id="share-link" readonly value="${this.escape(link)}" />
        <button class="btn" data-act="copy-link" style="margin:0;width:auto;padding:0 18px;">Kopieren</button>
      </div>
      <button class="btn" data-act="copy-code" style="margin-top:10px;">📋 Code kopieren</button>
      <div class="spinner"></div>
      <div class="status">Warte auf Gegenspieler…</div>
      <div class="back-link" data-act="cancel">← Lobby verlassen</div>
    `,
      'lobby-host',
    );
    this.bind('[data-act="copy-link"]', () => {
      this.copy(link);
      this.toast('Link kopiert! 🎉');
    });
    this.bind('[data-act="copy-code"]', () => {
      this.copy(code);
      this.toast('Code kopiert!');
    });
    this.bind('[data-act="cancel"]', () => this.cb.onCancelLobby());
  }

  showControls(): void {
    this.setScreen(
      `
      <div class="logo" style="font-size:34px;">Steuerung</div>
      <div class="controls-help" style="margin-top:18px;">
        <p><span class="kbd">A</span> / <span class="kbd">←</span> nach links</p>
        <p><span class="kbd">D</span> / <span class="kbd">→</span> nach rechts</p>
        <p><span class="kbd">W</span> / <span class="kbd">↑</span> / <span class="kbd">Leertaste</span> springen</p>
        <p style="margin-top:14px;color:var(--muted)">Auf dem Handy: Tasten am Bildschirmrand.</p>
        <p style="margin-top:14px;">Spiele den Ball über das Netz auf den Boden des Gegners.<br/>Wer zuerst <b>15 Punkte</b> (mit 2 Vorsprung) hat, gewinnt!</p>
      </div>
      <div class="back-link" data-act="back" style="margin-top:24px;">← Zurück</div>
    `,
      'controls',
    );
    this.bind('[data-act="back"]', () => this.showMain());
  }

  showMatchOver(playerWon: boolean, left: number, right: number, online: boolean): void {
    this.hideHud();
    this.setScreen(
      `
      <div class="match-result ${playerWon ? 'win' : 'lose'}">${playerWon ? '🏆 Gewonnen!' : '😤 Verloren'}</div>
      <div class="final-score"><span style="color:var(--left)">${left}</span> : <span style="color:var(--right)">${right}</span></div>
      <button class="btn primary" data-act="rematch"><span class="emoji">🔁</span> Revanche</button>
      <button class="btn" data-act="menu"><span class="emoji">🏠</span> Hauptmenü</button>
    `,
      'matchover',
    );
    this.bind('[data-act="rematch"]', () => this.cb.onRematch());
    this.bind('[data-act="menu"]', () => this.cb.onExitToMenu());
    void online;
  }

  // --- HUD ---------------------------------------------------------------
  private buildHud(): void {
    this.hud.innerHTML = `
      <div class="scoreboard">
        <div class="score-side left">
          <div class="name" id="hud-left-name">Du</div>
          <div class="value" id="hud-left-score">0</div>
        </div>
        <div class="score-divider"></div>
        <div class="score-side right">
          <div class="name" id="hud-right-name">CPU</div>
          <div class="value" id="hud-right-score">0</div>
        </div>
      </div>
      <div class="hud-corner right">
        <div class="pill" id="ping-pill" style="display:none;">
          <span class="ping-dot"></span><span id="ping-text">— ms</span>
        </div>
        <div class="pill" id="menu-pill">☰ Menü</div>
      </div>
    `;
    this.leftScoreEl = this.hud.querySelector('#hud-left-score') as HTMLElement;
    this.rightScoreEl = this.hud.querySelector('#hud-right-score') as HTMLElement;
    this.leftNameEl = this.hud.querySelector('#hud-left-name') as HTMLElement;
    this.rightNameEl = this.hud.querySelector('#hud-right-name') as HTMLElement;
    this.pingPill = this.hud.querySelector('#ping-pill') as HTMLElement;
    this.pingText = this.hud.querySelector('#ping-text') as HTMLElement;
    (this.hud.querySelector('#menu-pill') as HTMLElement).addEventListener('click', () =>
      this.cb.onExitToMenu(),
    );
  }

  showHud(leftName: string, rightName: string, online: boolean): void {
    this.hud.classList.remove('hidden');
    this.leftNameEl.textContent = leftName;
    this.rightNameEl.textContent = rightName;
    this.pingPill.style.display = online ? 'flex' : 'none';
    this.updateScore(0, 0);
  }
  hideHud(): void {
    this.hud.classList.add('hidden');
    this.banner.classList.add('hidden');
  }

  updateScore(left: number, right: number): void {
    if (this.leftScoreEl.textContent !== String(left)) {
      this.leftScoreEl.textContent = String(left);
      this.bumpScore(this.leftScoreEl);
    }
    if (this.rightScoreEl.textContent !== String(right)) {
      this.rightScoreEl.textContent = String(right);
      this.bumpScore(this.rightScoreEl);
    }
  }
  private bumpScore(el: HTMLElement): void {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  updatePing(ms: number): void {
    this.pingText.textContent = `${ms} ms`;
    const dot = this.pingPill.querySelector('.ping-dot') as HTMLElement;
    dot.style.background = ms < 80 ? '#42e6a4' : ms < 160 ? '#ffd23f' : '#ff5470';
  }

  // --- Banner (countdown / point) ----------------------------------------
  showCountdown(n: number): void {
    this.banner.classList.remove('hidden');
    this.banner.innerHTML =
      n > 0 ? `<div class="big">${n}</div>` : `<div class="big" style="color:var(--accent)">LOS!</div>`;
  }
  showPoint(text: string, color: string): void {
    this.banner.classList.remove('hidden');
    this.banner.innerHTML = `<div class="label" style="color:${color}">${text}</div>`;
  }
  hideBanner(): void {
    this.banner.classList.add('hidden');
  }

  // --- Touch controls ----------------------------------------------------
  private buildTouch(): void {
    this.touch.innerHTML = `
      <div class="touch-cluster">
        <div class="touch-btn" data-dir="left">◀</div>
        <div class="touch-btn" data-dir="right">▶</div>
      </div>
      <div class="touch-cluster">
        <div class="touch-btn" data-dir="jump">⤒</div>
      </div>
    `;
    const bindBtn = (sel: string, key: 'left' | 'right' | 'jump') => {
      const el = this.touch.querySelector(sel) as HTMLElement;
      const set = (v: boolean) => (e: Event) => {
        e.preventDefault();
        this.cb.onTouch({ [key]: v });
      };
      el.addEventListener('touchstart', set(true), { passive: false });
      el.addEventListener('touchend', set(false), { passive: false });
      el.addEventListener('touchcancel', set(false), { passive: false });
      el.addEventListener('mousedown', set(true));
      el.addEventListener('mouseup', set(false));
      el.addEventListener('mouseleave', set(false));
    };
    bindBtn('[data-dir="left"]', 'left');
    bindBtn('[data-dir="right"]', 'right');
    bindBtn('[data-dir="jump"]', 'jump');
  }

  enableTouch(on: boolean): void {
    this.touch.classList.toggle('active', on);
  }

  // --- Toast -------------------------------------------------------------
  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2400);
  }

  hideOverlay(): void {
    this.setScreen('', 'none');
  }

  // --- helpers -----------------------------------------------------------
  private bind(sel: string, fn: () => void): void {
    const el = this.overlay.querySelector(sel);
    if (el) el.addEventListener('click', fn);
  }
  private readName(): string {
    const el = this.overlay.querySelector('#name-input') as HTMLInputElement | null;
    const n = (el?.value || '').trim();
    if (n) this.setName(n);
    return n || 'Blobby';
  }
  private escape(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  }
  private copy(text: string): void {
    navigator.clipboard?.writeText(text).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* ignore */
      }
      ta.remove();
    });
  }

  static sideColor(side: Side): string {
    return side === Side.Left ? 'var(--left)' : 'var(--right)';
  }
}
