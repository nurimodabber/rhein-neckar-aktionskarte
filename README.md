# Rhein-Neckar Cluster – Interaktive Aktionskarte

Eine vollwertige, offline-fähige Aktions- und Wachstumsplanung für den **Cluster Rhein-Neckar** (Rhein-Neckar-Kreis, Stadtkreis Mannheim, Stadtkreis Heidelberg sowie Speyer) zur strategischen Begleitung des Wachstums (Nuklei, Kernaktivitäten, Meilensteine PG/IPG/IPG+ und Entsendungen von Pionieren und Teams).

Die Farbgebung orientiert sich an der offiziellen Einteilung der **Region Süd**:
* **PG** (Hellgrün): Vorbereitung / Programm des Wachstums
* **IPG** (Mittelgrün): Intensives Programm des Wachstums
* **IPG+** (Dunkelgrün): Weit fortgeschrittenes Intensives Programm des Wachstums
* **Noch nicht begonnen** (Hellgrau): Bislang keine reguläre Aktivität

---

## 🚀 Schnellstart

### Option 1: Direkt im Browser öffnen
Doppelklicke einfach auf `index.html` oder öffne die Datei im Browser:
```bash
open index.html
```

### Option 2: Lokalen Webserver starten
```bash
./start.sh
# oder
python3 server.py
```
Die Anwendung öffnet sich unter `http://localhost:8080`.

---

## 🌟 Funktionsumfang

### 1. Interaktive Karte aller 132 Kommunen & 83 Stadtteile
* Umfasst **132 Städte & Gemeinden** des Metropol- und Vorderpfalz-Clusters:
  * **5 Kreisfreie Städte**: Mannheim, Heidelberg, Ludwigshafen am Rhein, Frankenthal (Pfalz), Speyer
  * **Rhein-Neckar-Kreis (54 Gemeinden)**
  * **Rhein-Pfalz-Kreis (25 Gemeinden)**
  * **Landkreis Bad Dürkheim (48 Gemeinden)**
* **83 offizielle Nachbarschaften & Stadtteile** für detaillierte Innenstadt- und Quartiersplanung.
* Angrenzende Regionen dezent im Hintergrund.

### 2. Arbeitsmodi & Interaktionen
1. **🔍 Info & Details (Inspektions-Modus)**:
   * Klick auf eine Ortschaft öffnet die macOS-Seitenleiste mit allen Kennzahlen und Nachbarschafts-Akkordeons.
2. **🎨 Schnell-Einfärben (Paint-Bucket-Modus)**:
   * Wähle eine Farbe/Stufe in der Schnellpalette und färbe Kommunen oder Stadtteile mit einem Klick ein.
3. **🏹 Entsendungen & Pfeilverbindungen**:
   * Verbindung zwischen Start- und Zielort mit Zweck, Personenanzahl und Status.
   * **Intelligente Bézier-Kurven**: Mehrere Verbindungen und Hin-/Rückwege fächern sich automatisch auf und überlappen nicht.
   * **Schnell-Aktionsleiste**: 1 Klick auf einen Pfeil öffnet ein schwebendes HUD zum sofortigen Umschalten (● Aktiv, ⏳ In Planung, ✓ Etabliert) oder Löschen.

### 3. Revisionsverlauf & Datensicherheit
* **↶ Undo (⌘Z / Strg+Z) & ↷ Redo (⇧⌘Z / Strg+Y)**: Jede Änderung (Meilenstein, Zahl, Pfeil, Notiz) kann blitzschnell rückgängig gemacht werden.
* **Automatische Backups (Verlauf)**: Fortlaufende lokale Sicherungspunkte mit 1-Klick-Wiederherstellung.
* **Sicherer Reset**: Vor einem Zurücksetzen wird automatisch ein Sicherungspunkt angelegt.
* **JSON-Export & Import**: Vollständiger Austausch von Projektständen zwischen Teammitgliedern.
* **PNG-Kartenspeicherung**: Hochauflösender Bildexport für Dokumente und Konferenzen.

### 4. PWA (Progressive Web App) & Offline-Nutzung
* **100% offline**: Alle Kartendaten, Bibliotheken und Schriften liegen lokal vor.
* **App-Installation**:
  * **Mac**: Safari → *Ablage* → *Zum Dock hinzufügen...* (öffnet als rahmenlose native macOS-App).
  * **iPad / iPhone**: Safari → *Zum Home-Bildschirm*.
  * **Chrome / Edge**: Klick auf das Installationssymbol in der Adressleiste.

### 5. GitHub Pages Bereitstellung
* Sobald die Planungsphase abgeschlossen ist, kann das Repository mit 1 Befehl auf GitHub synchronisiert werden.
* Eine fertige GitHub Actions Pipeline (`.github/workflows/deploy.yml`) veröffentlicht die Seite automatisch auf GitHub Pages. Siehe [DEPLOYMENT.md](DEPLOYMENT.md).

---

## 📁 Dateistruktur

```
.
├── index.html                 # Apple HIG Benutzeroberfläche & HUDs
├── style.css                  # Modernes Carto-Styling, Frosted Glass, Popovers
├── app.js                     # Anwendungslogik, Undo/Redo, SVG-Pfeile, Storage
├── manifest.json              # PWA-Konfiguration
├── sw.js                      # Offline-Service-Worker
├── icon.svg                   # Vektor-App-Icon
├── DEPLOYMENT.md              # Anleitung für GitHub Pages & Online-Release
├── rhein_neckar_data.js       # Geometrien der 132 Kommunen (Rhein-Neckar & Vorderpfalz)
├── rhein_neckar_districts.js  # Geometrien der 83 Stadtteile
├── surrounding_kreise.js      # Umgebende Nachbarkreise
├── rivers_data.js             # Rhein, Neckar und Gewässerläufe
├── geographic_landmarks.js    # Autobahnen & Landmarken
└── lib/                       # Offline-Bibliotheken (Leaflet, html2canvas)
```
