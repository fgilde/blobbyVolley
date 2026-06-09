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

Der Client liegt statisch auf GitHub Pages. Der Online-Modus verbindet sich mit
einem kleinen **Lobby-/Relay-Server** (WebSocket), der kostenlos auf Render läuft
— der Lobby-Ersteller rechnet die Physik, der Server reicht die Nachrichten
zwischen beiden Spielern durch.

### Relay-Server deployen (einmalig, kostenlos)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/fgilde/blobbyVolley)

1. Auf den Button klicken (oder bei Render „New → Blueprint" mit diesem Repo).
2. Render liest `render.yaml`, baut den Dienst und gibt eine URL wie
   `https://blobbyvolley-relay-fgilde.onrender.com` aus.
3. Die Pages-App ist bereits auf genau diese URL eingestellt (`VITE_RELAY_URL`).
   Weicht deine URL ab, einfach per Parameter testen:
   `https://fgilde.github.io/blobbyVolley/?relay=wss://DEINE-URL.onrender.com`

> Der kostenlose Render-Dienst schläft nach ~15 Min Inaktivität ein; der erste
> Verbindungsversuch danach weckt ihn (~30 s), danach läuft alles flüssig.

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
den interpolierten Zustand. Der Relay-Server pairt die beiden Spieler über den
Lobby-Code und leitet die Nachrichten weiter — er rechnet selbst nichts.

> **Server-Adresse überschreiben** (ohne Neu-Build): `…/?relay=wss://host` —
> praktisch für eigenes Hosting oder schnelles Testen.

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
    protocol.ts       Wire-Protokoll (Client ↔ Relay)
    NetClient.ts      WebSocket-Client + Lobby-Logik (Relay-URL konfigurierbar)
  ui/
    UI.ts             Menüs, HUD, Banner, Touch-Controls
    styles.css        Glassmorphism-Oberfläche
  main.ts             verdrahtet alles zusammen
server/
  server.js           Lobby-/Relay-Server (Render) + optionales statisches Hosting
  test-lobby.mjs      Integrationstest des Relays
render.yaml           Render-Blueprint für den Relay-Server
```

## Tests / Checks

```bash
npm run typecheck    # strenge TypeScript-Prüfung
npm run test:lobby   # End-to-End-Test des Lobby-Relays (Server muss laufen)
```

## Lizenz

MIT
