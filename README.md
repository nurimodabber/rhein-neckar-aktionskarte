# Rhein-Neckar Cluster – Interaktive Aktionskarte

Eine vollwertige, offline-fähige Aktions- und Wachstumsplanung für den **Cluster Rhein-Neckar** (133 Städte und Gemeinden: Mannheim, Heidelberg, Ludwigshafen am Rhein, Speyer, Frankenthal (Pfalz), Neustadt an der Weinstraße, Rhein-Neckar-Kreis, Rhein-Pfalz-Kreis und Landkreis Bad Dürkheim) zur strategischen Begleitung des Wachstums (Nuklei, Kernaktivitäten, Meilensteine PG/IPG/IPG+ und Entsendungen von Pionieren und Teams).

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

## Funktionsumfang

### 1. Interaktive Karte aller 133 Kommunen & 162 Stadtteile
* Umfasst **133 Städte & Gemeinden** des Metropol- und Vorderpfalz-Clusters:
  * **6 Kreisfreie Städte**: Mannheim, Heidelberg, Ludwigshafen am Rhein, Frankenthal (Pfalz), Speyer, Neustadt an der Weinstraße
  * **Rhein-Neckar-Kreis (54 Gemeinden)**
  * **Rhein-Pfalz-Kreis (25 Gemeinden)**
  * **Landkreis Bad Dürkheim (48 Gemeinden)**
* **4 Entsende-Zentren (★)**: Mannheim, Heidelberg, Speyer, Leimen
* **162 offizielle Nachbarschaften & Stadtteile** in 35 Städten und Gemeinden (u. a. hochaufgelöste amtliche Stadtteilgrenzen für Heidelberg, Mannheim, Ludwigshafen, Neustadt, Frankenthal, Speyer, Bad Dürkheim, Weinheim, Sinsheim, Wiesloch, Edingen-Neckarhausen, St. Leon-Rot, Hirschberg, Rauenberg, Mühlhausen u.v.m.) für detaillierte Innenstadt- und Quartiersplanung.
* Angrenzende Regionen dezent im Hintergrund.

### 2. Arbeitsmodi & Interaktionen
1. **Info & Details (Inspektions-Modus)**:
   * Klick auf eine Ortschaft öffnet die Seitenleiste mit Kennzahlen und Nachbarschafts-Akkordeons.
2. **Schnell-Einfärben (Paint-Modus)**:
   * Wähle eine Stufe in der Farbpalette und färbe Kommunen oder Stadtteile mit einem Klick ein.
3. **Entsendungen & Pfeilverbindungen**:
   * Verbindung zwischen Start- und Zielort mit Zweck, Personenanzahl und Status.
   * **Bézier-Kurven**: Mehrere Verbindungen und Hin-/Rückwege fächern sich auf und überlappen nicht.
   * **Schnell-Aktionsleiste**: Klick auf einen Pfeil öffnet ein schwebendes Menü zum Umschalten (Aktiv, In Planung, Etabliert) oder Löschen.

### 3. Revisionsverlauf & Datensicherheit
* **Undo (⌘Z / Strg+Z) & Redo (⇧⌘Z / Strg+Y)**: Änderungen (Meilenstein, Zahl, Pfeil, Notiz) können rückgängig gemacht werden.
* **Automatische Sicherungen**: Fortlaufende lokale Sicherungspunkte mit Wiederherstellung.
* **Sicherer Reset**: Vor einem Zurücksetzen wird automatisch ein Sicherungspunkt angelegt.
* **JSON-Export & Import**: Austausch von Projektständen zwischen Mitarbeitern.
* **PNG-Export**: Bildexport für Dokumente und Berichte.

### 4. PWA (Progressive Web App) & Offline-Nutzung
* **Offline-Betrieb**: Alle Kartendaten, Bibliotheken und Schriften liegen lokal vor.
* **App-Installation**:
  * **Mac**: Safari → *Ablage* → *Zum Dock hinzufügen...*
  * **iPad / iPhone**: Safari → *Zum Home-Bildschirm*.
  * **Chrome / Edge**: Klick auf das Installationssymbol in der Adressleiste.

### 5. Deployment
* Siehe [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Dateistruktur

```
.
├── index.html                 # Benutzeroberfläche & Menüs
├── style.css                  # Kartenspezifische Gestaltung & Popovers
├── app.js                     # Anwendungslogik, Undo/Redo, SVG-Pfeile, Storage
├── manifest.json              # PWA-Konfiguration
├── sw.js                      # Offline-Service-Worker
├── icon.svg                   # Vektor-App-Icon
├── DEPLOYMENT.md              # Anleitung für Deployment & Online-Release
├── rhein_neckar_data.js       # Geometrien der 133 Kommunen (Rhein-Neckar & Vorderpfalz)
├── rhein_neckar_districts.js  # Geometrien der 162 Stadtteile / Nachbarschaften
├── surrounding_kreise.js      # Umgebende Nachbarkreise
├── rivers_data.js             # Rhein, Neckar und Gewässerläufe
├── geographic_landmarks.js    # Autobahnen & Landmarken
└── lib/                       # Offline-Bibliotheken (Leaflet, html2canvas, qrcode)
```
