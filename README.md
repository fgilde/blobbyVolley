# 🏐 Blobby Volley · 3D

Ein moderner, webbasierter Blobby-Volley-Clone mit **Three.js** — gegen die CPU
(vier Schwierigkeitsgrade) oder online gegen Freunde per Lobby-Code.

![Blobby Volley](https://img.shields.io/badge/Three.js-WebGL-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)

## Features

- 🎮 **Einzelspieler vs. CPU** — vier Schwierigkeitsgrade (`Locker`, `Solide`, `Profi`, `Wahnsinn`)
  mit unterschiedlicher Reaktionszeit, Vorhersage, Zielgenauigkeit und Aggressivität.
- 🌐 **Online-Multiplayer** — Lobby erstellen, 4-stelligen Code oder Einladungs-Link
  teilen, Gegner tritt per Code oder URL (`?lobby=CODE`) bei.
- 🎨 **Moderne 3D-Optik** — weiche Schatten, Bloom-Postprocessing, Squash-&-Stretch-Blobs
  mit den Ball verfolgenden Augen, Partikeleffekte, Kamera-Shake, animierter Hintergrund.
- 📱 **Touch-Steuerung** für mobile Geräte, Tastatur für den Desktop.
- 🤖 **Attract-Mode** — im Menü spielen zwei CPUs im Hintergrund.

## 🎮 Live spielen

**<https://fgilde.github.io/blobbyVolley/>**

Der Online-Modus läuft **komplett ohne eigenen Backend-Server** über WebRTC
Peer-to-Peer (Signaling via kostenloser PeerJS-Cloud) — deshalb kann das ganze
Spiel als statische Seite auf GitHub Pages gehostet werden.

## Schnellstart (lokal)

```bash
npm install
npm run dev
```

Öffne <http://localhost:5173>. Für den reinen Client genügt `npm run dev:client`
— der Online-Modus braucht **keinen** lokalen Server, da die Verbindung P2P läuft.

### Produktion / eigenes Hosting

```bash
npm run build      # baut den statischen Client nach dist/
```

`dist/` kann auf **jedem** statischen Host liegen (GitHub Pages, Netlify, …).
Optional liegt unter `server/` noch ein klassischer WebSocket-Relay + statisches
Hosting (`npm start`), falls du lieber einen eigenen Server betreiben möchtest.

## Steuerung

| Aktion        | Tasten                          |
| ------------- | ------------------------------- |
| Nach links    | `A` / `←`                       |
| Nach rechts   | `D` / `→`                       |
| Springen      | `W` / `↑` / `Leertaste`         |
| Mobil         | Buttons am unteren Bildschirmrand |

Wer zuerst **15 Punkte** mit mindestens **2 Punkten Vorsprung** erreicht, gewinnt.
Der Gewinner eines Ballwechsels hat den nächsten Aufschlag.

## Online spielen

1. **Online Multiplayer → Lobby erstellen.** Du erhältst einen Code (z. B. `CEEL`) und einen Link.
2. Teile **Code** oder **Link** mit deinem Gegner.
3. Der Gegner wählt **Mit Code beitreten** und gibt den Code ein — oder öffnet einfach den Link.
4. Sobald beide verbunden sind, startet das Match automatisch.

Der **Ersteller der Lobby** (links) berechnet die maßgebliche Physik und streamt
Snapshots (30 Hz); der Beitretende (rechts) sendet seine Eingaben und rendert
den interpolierten Zustand. Die Daten fließen **direkt** zwischen beiden Browsern
(WebRTC-DataChannel); der Lobby-Code ist die Peer-ID beim Signaling-Broker.

> **Falls der öffentliche PeerJS-Broker mal überlastet ist:** Man kann einen
> eigenen [PeerServer](https://github.com/peers/peerjs-server) betreiben und per
> URL-Parameter ansteuern, z. B. `…/?peer=mein-server.de:9000/myapp`.

## Architektur

```
src/
  game/
    constants.ts      Welt-Konstanten, Typen
    Simulation.ts     deterministische 2D-Physik (Ball, Blobs, Netz, Score)
    AI.ts             CPU-Gegner mit Schwierigkeitsprofilen
    Input.ts          Tastatur- + Touch-Eingabe
    GameController.ts  Spielablauf, fester Zeitschritt, Netcode-Glue
  render/
    GameRenderer.ts   Three.js-Szene, Licht, Schatten, Kamera, Bloom
    BlobMesh.ts       animierter Blob (Squash & Stretch, Augen)
    Particles.ts      GPU-Partikelsystem (Custom-Shader)
    textures.ts       prozedurale Texturen (Strandball, Sand, Himmel)
  net/
    protocol.ts       Nachrichten-Protokoll (über den DataChannel)
    NetClient.ts      WebRTC-P2P-Client (PeerJS) + Lobby-Logik
  ui/
    UI.ts             Menüs, HUD, Banner, Touch-Controls
    styles.css        Glassmorphism-Oberfläche
  main.ts             verdrahtet alles zusammen
server/                (optional, nur für Self-Hosting ohne P2P)
  server.js           klassischer Relay-/Lobby-Server + statisches Hosting
  test-lobby.mjs      Integrationstest des Relays
```

## Tests / Checks

```bash
npm run typecheck    # strenge TypeScript-Prüfung
npm run test:lobby   # End-to-End-Test des Lobby-Relays (Server muss laufen)
```

## Lizenz

MIT
