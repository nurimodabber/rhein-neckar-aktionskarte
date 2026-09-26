# Rhein-Neckar Cluster – Interaktive Aktionskarte

Eine vollwertige, interaktive Aktionskarte für den **Cluster Rhein-Neckar** (Rhein-Neckar-Kreis, Stadtkreis Mannheim, Stadtkreis Heidelberg) zur strategischen Planung und Begleitung des Wachstums (Nuklei, Kernaktivitäten, Meilensteine PG/IPG/IPG+ und Entsendungen von Ressourcen und Pionieren).

Die Farbgebung orientiert sich exakt an der offiziellen Einteilung der **Region Süd** (Stand: Februar 2026):
* **PG** (Hellgrün): Vorbereitung / Programm des Wachstums
* **IPG** (Mittelgrün): Intensives Programm des Wachstums
* **IPG+** (Dunkelgrün): Weit fortgeschrittenes Intensives Programm des Wachstums
* **Noch nicht begonnen** (Hellgrau): Bislang keine reguläre Aktivität

---

## 🚀 Schnellstart

### Option 1: Direkt im Browser öffnen
Doppelklicke einfach auf die Datei `index.html` oder öffne sie in Safari, Chrome, Firefox oder Edge:
```bash
open index.html
```

### Option 2: Lokalen Webserver starten
Alternativ kannst du den integrierten Server starten:
```bash
./start.sh
# oder
python3 server.py
```
Die Anwendung öffnet sich automatisch unter `http://localhost:8080`.

---

## 🌟 Funktionsumfang

### 1. Interaktive Karte aller 56 Kommunen
* Enthält alle **54 Städte & Gemeinden des Rhein-Neckar-Kreises** sowie die beiden Stadtkreise **Mannheim** und **Heidelberg**.
* Exakte geografische Grenzen (GeoJSON) mit flüssiger Vektordarstellung.
* Mouseover-Tooltip mit sofortiger Zusammenfassung (Meilenstein, Nuklei, Andachten, Studienkreise, Kinderklassen, Juniorengruppen, Zentrumsstatus).

### 2. Drei Arbeitsmodi (über die obere Leiste)
1. **🔍 Info & Details (Inspektions-Modus)**:
   * Klick auf eine Ortschaft öffnet die Seitenleiste mit allen Details.
   * Pflege von Wachstumsstufen, genauen Zahlen für alle 4 Kernaktivitäten und Notizen.
2. **🎨 Schnell-Einfärben (Paint-Bucket-Modus)**:
   * Wähle eine Farbe/Stufe (PG, IPG, IPG+, Zurücksetzen) in der Schnell-Palette.
   * Klicke nacheinander auf Ortschaften auf der Karte, um sie sofort einzufärben.
3. **🏹 Pfeil zeichnen (Entsendungs-Modus)**:
   * **Schritt 1**: Klicke auf das Start-Zentrum (von dem Personen entsandt werden, z.B. Heidelberg oder Mannheim).
   * **Schritt 2**: Klicke auf die Ziel-Ortschaft (z.B. Eberbach, Sinsheim oder Schwetzingen).
   * **Schritt 3**: Trage Zweck (Pioniere, Wanderlehrer, Projektbegleitung, Kinderklassenlehrer, Juniorenanimateur), Personenanzahl, Frequenz und Notiz ein.
   * Auf der Karte erscheint ein animierter, geschwungener Pfeil mit Strömungsanimation und Klick-Inspektion!

### 3. Detail-Seitenleiste pro Ortschaft
* **Meilenstein-Auswahl**: Keine Aktivität, PG, IPG, IPG+ oder freie Farbwahl.
* **★ Entsende-Zentrum Toggle**: Kennzeichnet etablierte Gemeinschaften als Ressourcen- und Entsende-Pools (erscheinen mit Stern auf der Karte).
* **Nuklei-Zähler**: Zahl der aktiven Keimzellen.
* **Aufschlüsselung der 4 Kernaktivitäten**:
  * 📿 Andachtstreffen
  * 📖 Studienkreise
  * 🎨 Kinderklassen
  * 🌟 Juniorengruppen
  * Gesamtsumme wird automatisch errechnet.
* **Entsendungen & Beziehungen**: Zeigt alle eingehenden und ausgehenden Pfeile der Ortschaft an.
* **Notizen**: Freitextfeld für Termine, Ansprechpartner und Reflexionen.

### 4. Automatische Speicherung, Export & Import
* **Auto-Save**: Alle Änderungen werden im Browser (`localStorage`) gespeichert.
* **💾 Export (JSON)**: Speichert den kompletten Projektstand (alle 56 Orte, Notizen und Pfeile) als Sicherungsdatei.
* **📂 Import (JSON)**: Ermöglicht das Wiederherstellen oder Teilen von Ständen zwischen Teammitgliedern.
* **📸 Bild (PNG)**: Erstellt einen Screenshot der aktuellen Karte für Berichte, Präsentationen oder Treffen.
* **📊 Cluster-Bericht**: Zeigt eine durchsuchbare Gesamttabelle aller Kommunen.
* **🔄 Reset**: Setzt die Karte auf realistische Musterdaten zurück.

---

## 📁 Dateistruktur

```
.
├── index.html              # Haupt-Anwendung (HTML5 / UI)
├── style.css               # Modernes responsives Design, Farbschemata, Drawer & Modals
├── app.js                  # Anwendungslogik, Leaflet-Events, SVG-Bézier-Pfeile, Storage
├── rhein_neckar_data.js    # GeoJSON-Geometrien aller 56 Gemeinden & Zentroide
├── server.py               # Lokaler HTTP-Server (optional)
├── start.sh                # Schnellstart-Skript für macOS / Linux
└── lib/                    # Lokale Offline-Bibliotheken (Leaflet, html2canvas)
```
