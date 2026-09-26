# GitHub Pages & PWA Deployment-Anleitung

Diese Anleitung führt dich durch die Schritte, um die **Rhein-Neckar Cluster Aktionskarte** online auf GitHub bereitzustellen, sobald deine Planungsphase abgeschlossen ist.

---

## 1. Voraussetzungen
- Ein kostenloser Account auf [GitHub.com](https://github.com)
- Ein neues, leeres Repository (z. B. `rhein-neckar-karte` oder `cluster-map`)

---

## 2. Projekt mit GitHub verbinden und hochladen

Führe in diesem Ordner im Terminal folgende Befehle aus (ersetze `<DEIN-NUTZERNAME>` und `<REPO-NAME>` durch deine Daten):

```bash
# 1. GitHub Remote hinzufügen (falls noch nicht geschehen)
git remote add origin https://github.com/<DEIN-NUTZERNAME>/<REPO-NAME>.git

# 2. Hauptbranch auf 'main' setzen
git branch -M main

# 3. Hochladen
git push -u origin main
```

---

## 3. GitHub Pages aktivieren

Sobald der Code auf GitHub liegt:
1. Öffne dein Repository auf GitHub im Browser.
2. Gehe auf **Settings** (Einstellungen) → **Pages** (in der linken Seitenleiste).
3. Unter **Source** wählst du:
   - **GitHub Actions** (empfohlen – der mitgelieferte Workflow `.github/workflows/deploy.yml` baut und veröffentlicht die Seite automatisch bei jedem Push!).
   - *Alternativ:* Wähle **Deploy from a branch** → Branch `main` → Ordner `/ (root)` → **Save**.
4. Nach etwa 1–2 Minuten ist deine Aktionskarte weltweit erreichbar unter:
   `https://<DEIN-NUTZERNAME>.github.io/<REPO-NAME>/`

---

## 4. Als native App (PWA) auf Mac, iPad & iPhone installieren

Die Webseite ist als **Progressive Web App (PWA)** vorkonfiguriert:
- **Auf dem Mac (Safari / Chrome)**:
  - In Safari: Menüleiste **Ablage** → **Zum Dock hinzufügen...**
  - In Chrome: Im Adressfeld rechts auf das Installationssymbol klicken (oder Menü → *App installieren*).
  - Die Karte öffnet sich fortan in einem eigenen, rahmenlosen macOS-Fenster ohne Browserleisten und funktioniert 100% offline!
- **Auf dem iPad / iPhone**:
  - Im Safari-Teilen-Menü (Viereck mit Pfeil nach oben) auf **„Zum Home-Bildschirm“** tippen.
  - Startet im Vollbild wie eine native iOS-App.
