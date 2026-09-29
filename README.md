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
```

### Wie kommen später echte Werte in die App?

Laut Datenweg liest ein Edge-/Gateway-Server die Werte per OPC UA (nur lesend) von der SPS S7-1516 und stellt sie
per REST bereit. In `js/data.js` liefert `Gateway.getStation(id, scenario)` heute Beispieldaten in genau dieser Form.
Später ersetzt man den Inhalt der Funktion durch einen `fetch()`-Aufruf an das Gateway. Der Rest der App bleibt gleich.

### Änderungen an der Vorlage

- Im Hochformat nutzt die Kamera `object-fit: cover` statt `contain`, sonst bleibt nur ein schmaler Streifen.
- Die A-Frame-Szene füllt genau den Bildschirm.
- Die Debug-Funktionen `fireEventMarkerFound()` und `fireEventMarkerLost()` gibt es weiterhin.
