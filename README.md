# Industrie 4.0 AR Mockup

Contains a simple template for starting with an AR featured Web-APP using AFrame and AR.js.

## Marker used

- https://de.wikiversity.org/wiki/Datei:Hiro_marker_ARjs.png

---

## Unser Mockup: Station Qualitätskontrolle (CPS-i40)

Die App zeigt die Ergebnisse der Kameraprüfung (Vision Sensor CS 50) direkt am Bauteil an.
Ablauf: **Scannen → AR-Ansicht → Details**.

1. **Scannen:** Die Kamera sucht den QR-Code der Station. Alternativ erkennt die App den
   Hiro-Marker aus der Vorlage (er steht stellvertretend für den QR-Code der Station 07).
2. **AR-Ansicht:** Oben steht groß das Ergebnis (bestanden / nicht bestanden / keine aktuellen Daten).
   Eine Karte am Bauteil zeigt Dosennummer und Inhalt (Kugeln je Farbe). Am Marker leuchtet ein Ring in der Ergebnisfarbe.
3. **Details:** Kugeln je Farbe (Ist gegen Soll), Sensor, Steuerung, Zeitpunkt.
   Die App liest nur und steuert die Anlage nicht.

Der Deckel wird erst in der nächsten Station geprüft und kommt in dieser App nicht vor. Die Messwerte sind Beispieldaten. Das Anforderungsdokument steht im Word-Dokument der Gruppe.

### Ausprobieren

Die Kamera funktioniert nur über `https://` oder `http://localhost`. Lokal starten:

```bash
python -m http.server 8000
```

Dann `http://localhost:8000` öffnen (am Handy über https, z. B. GitHub Pages).

| Adresse | Wirkung |
| --- | --- |
| `?station=07` | springt direkt zur Station 07 |
| `?station=07&state=nok` | zeigt den Fehlerfall (`ok`, `nok` oder `stale`) |
| `?bg=demo` | Demo-Bild statt Kamera |

Ohne Kamera (Laptop): Button „Ohne Kamera testen“ oder oben rechts **Demo** öffnen. Dort lässt sich das Beispiel-Ergebnis
umschalten: Bestanden, Nicht bestanden, Keine Verbindung.

**QR-Code zum Testen:** [`assets/qr-station-07.png`](assets/qr-station-07.png) (Inhalt: `CPS-I40:STATION:07`).
Ausdrucken oder am Bildschirm zeigen und vor die Kamera halten. Auch eine Adresse mit `?station=07` wird erkannt.

### Aufbau

```
index.html        Seite: Kamera (A-Frame + AR.js), Demo-Bild, Bedienoberfläche
css/app.css       Aussehen (dunkles Design, Ampelfarben)
js/app.js         Ablauf: QR (jsQR), Hiro-Marker, Ansichten, Details
js/data.js        Simuliertes Gateway mit Beispieldaten
assets/           QR-Code der Station 07
live.html         Live-Daten P-101 (WebSocket, MQTT, REST-Verlauf)
css/live.css, js/live.js
nodered/          Node-RED-Flow, Editor-Passwort-Skript und Tunnel-Dienst für den Raspberry Pi
```

Bei Änderungen an `css/` oder `js/` die Nummer hinter `?v=` in der HTML-Datei erhöhen, sonst mischt der Browser
alte und neue Dateien aus dem Cache.

## Datenaustausch in Node-RED (P-101 Vibration)

Node-RED auf dem Raspberry Pi (`rpi18`) liest einen Messwert per OPC UA und gibt ihn auf mehreren Wegen weiter.
Die Seite [`live.html`](live.html) zeigt ihn an.

```
Milo OPC UA ──► Node-RED (Pi) ──► Debug                                          Aufgabe 1
                              ├─► WebSocket /ws/p101 ──► live.html                Aufgabe 2
                              ├─► MQTT (HiveMQ)      ──► live.html                Aufgabe 3 + 4
                              ├─► SQLite ──► REST /api/p101/vibration/avg          Aufgabe 5 (Durchschnitt)
                              │          └─► REST /api/p101/vibration ──► live.html  Aufgabe 7 + 8 (Verlauf)
                              └─► Dashboard 2.0 /dashboard                         Aufgabe 10
HiveMQ /bbk-lf7/+/power-house/vibration ──► Node-RED ──► REST /api/bbk-lf7/gruppen  Aufgabe 3.1
```

| | Wert |
| --- | --- |
| OPC-UA-Server | `opc.tcp://milo.digitalpetri.com:62541/milo` (anonym, ohne Verschlüsselung) |
| NodeId | `ns=2;s=Demo.Alarms.Plant.PowerHouse.P-101.Vibration` (Double, mm/s, 0 bis 20, Alarm ab 4,5 / 7,1) |
| WebSocket | `ws://<pi>:1880/ws/p101`, über den Tunnel `wss://<tunnel>.lhr.life/ws/p101` |
| MQTT | `broker.hivemq.com`, Topic `/bbk-lf7/18/power-house/vibration` (18 = Kistennummer), im Browser `wss://broker.hivemq.com:8884/mqtt` |
| Andere Gruppen | abonniert `/bbk-lf7/+/power-house/vibration`, Vergleich unter `GET /api/bbk-lf7/gruppen` |
| REST | `GET /api/p101/vibration?minutes=5` Messwerte, `GET /api/p101/vibration/avg?minutes=5` Durchschnitt (je 1 bis 60 Minuten), JSON, CORS freigegeben |
| Datenbank | SQLite-Datei `~/.node-red/p101.db`, Relation `vibration(id, ts, value)`, Werte älter als 24 h werden gelöscht |
| Dashboard | `http://<pi>:1880/dashboard` (FlowFuse Node-RED Dashboard 2.0): Tacho, aktueller Wert, Ø 5 Minuten, Verlauf |

Jede Nachricht hat diese Form:

```json
{ "source": "P-101 Vibration", "nodeId": "ns=2;s=Demo.Alarms.Plant.PowerHouse.P-101.Vibration",
  "value": 1.976, "unit": "mm/s", "timestamp": "2026-10-13T11:13:50.695Z", "limits": { "high": 4.5, "highHigh": 7.1 } }
```

### Einrichtung auf dem Pi

1. Erweiterungen installieren: im Editor unter *Palette verwalten* `node-red-contrib-opcua` (getestet mit 0.2.355)
   und `@flowfuse/node-red-dashboard` (getestet mit 1.34.1).
2. Flow importieren: [`nodered/p101-datenaustausch.json`](nodered/p101-datenaustausch.json) über *Menü → Import*, dann *Deploy*.
3. Editor-Passwort setzen, bevor der Tunnel läuft: `bash editor-passwort.sh` (Skript aus [`nodered/`](nodered/editor-passwort.sh)).
4. Tunnel als Dienst einrichten (startet beim Hochfahren und nach Abbrüchen neu):
   ```bash
   cp p101-tunnel.sh ~/ && sudo cp p101-tunnel.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now p101-tunnel
   ```
   Das Skript ruft `ssh -R 80:127.0.0.1:1880 nokey@localhost.run` auf. Es heißt `127.0.0.1` statt `localhost`,
   weil `localhost` je nach System auf IPv6 zeigt und der Tunnel dann „502 Bad Gateway“ meldet.
5. Webapp öffnen: `https://omerjusufi.github.io/industrie-4.0-ar-mockup/live.html`

**Wechselnde Tunnel-Adresse:** Kostenlose localhost.run-Adressen ändern sich bei jedem Verbindungsaufbau und nach einigen
Stunden. Das Skript meldet jede neue Adresse per MQTT als *retained* Nachricht unter `bbk/25it1/rpi18/gateway`.
Die Webapp liest dieses Topic mit und verbindet WebSocket und REST automatisch neu. Ein alter Link mit `?gateway=…`
funktioniert deshalb weiter. Die Automatik lässt sich unter *Verbindung einstellen* abschalten.

| Befehl auf dem Pi | Wirkung |
| --- | --- |
| `journalctl -u p101-tunnel -o cat \| grep gemeldet \| tail -1` | aktuelle Tunnel-Adresse |
| `sudo systemctl restart p101-tunnel` | Tunnel neu aufbauen (neue Adresse) |
| `sudo systemctl disable --now p101-tunnel` | Tunnel aus, auch nach dem Hochfahren |

### Datenbank (Aufgabe 5.1 und 5.2)

Relationsschema: `vibration(id, ts, value)`, Primärschlüssel `id`

| Attribut | Typ | Bedeutung |
| --- | --- | --- |
| `id` | INTEGER, Primärschlüssel | fortlaufende Nummer |
| `ts` | INTEGER, NOT NULL, Index | Zeitpunkt der Messung in Millisekunden seit 1970 (UTC) |
| `value` | REAL, NOT NULL | Vibration in mm/s |

Durchschnitt der letzten 5 Minuten (`?` = jetzt minus 5 Minuten in ms):

```sql
SELECT AVG(value) AS avg, MIN(value) AS min, MAX(value) AS max, COUNT(*) AS n
FROM vibration
WHERE ts >= ?;
```

Messwerte der letzten 5 Minuten:

```sql
SELECT ts, value FROM vibration WHERE ts >= ? ORDER BY ts;
```

Die erste Version der Tabelle hatte keine `id`-Spalte. Der Flow baut eine solche Tabelle beim Start einmal um und
übernimmt dabei alle Werte.

SQLite braucht keine Zusatzpakete: Node.js 22 bringt `node:sqlite` mit. Für den Raspberry Pi 2 (32 Bit) gibt es
`node-red-node-sqlite` nicht vorkompiliert, deshalb lädt der Function-Node das eingebaute Modul.

Hinweise:
- **Editor-Passwort:** Der Tunnel macht den ganzen Node-RED auf Port 1880 öffentlich erreichbar, auch den Editor. Deshalb vorher das Passwort setzen.
- **Öffentliche Adresse:** Das Topic auf dem öffentlichen HiveMQ-Broker kann jeder lesen, also auch die Tunnel-Adresse. Erreichbar sind darüber nur die Messwerte und die Login-Seite des Editors.
- **Firewall:** Manche Netze sperren die Ports 1883 und 8884. Im WLAN der Schule kommt die Webapp dann nicht an MQTT, im LAN ging es.

### Wie kommen später echte Werte in die App?

Laut Datenweg liest ein Edge-/Gateway-Server die Werte per OPC UA (nur lesend) von der SPS S7-1516 und stellt sie
per REST bereit. In `js/data.js` liefert `Gateway.getStation(id, scenario)` heute Beispieldaten in genau dieser Form.
Später ersetzt man den Inhalt der Funktion durch einen `fetch()`-Aufruf an das Gateway. Der Rest der App bleibt gleich.

### Änderungen an der Vorlage

- Im Hochformat nutzt die Kamera `object-fit: cover` statt `contain`, sonst bleibt nur ein schmaler Streifen.
- Die A-Frame-Szene füllt genau den Bildschirm.
- Die Debug-Funktionen `fireEventMarkerFound()` und `fireEventMarkerLost()` gibt es weiterhin.
