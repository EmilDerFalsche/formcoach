# FormCoach – Technik-Analyse mit der Handykamera

Web-App (PWA), die mit der Handykamera **Kniebeugen, Liegestütze und Tennisschläge** (Aufschlag, Vorhand, Rückhand)
analysiert und persönliches Feedback gibt.
Die Gelenkpunkte kommen von **MediaPipe Pose Landmarker**. Alles läuft auf dem Gerät, es wird kein Video hochgeladen.

## Funktionen
- **Live-Training:** Wiederholungszähler, Feedback nach jeder Wiederholung (Text, Sprache, Vibration), fehlerhafte Gelenke werden rot markiert, Tiefenbalken.
- **Video-Analyse:** aufgenommenen Satz hochladen, Bericht pro Wiederholung.
- **Auswertung:** Ø-Score, priorisierte Tipps, Verlauf der Hüfttiefe, Kennzahlen pro Wiederholung, Trainingsverlauf (lokal gespeichert).
- **Erkannte Fehler:** zu wenig Tiefe, zu starke Vorlage, Hüfte kommt zuerst hoch, Knie fallen nach innen, Fersen heben ab, Asymmetrie, zu schnelles Absenken.
  Welche Prüfungen laufen, hängt von der automatisch erkannten Kameraperspektive ab (seitlich, frontal oder diagonal).

### Liegestütz (seitliche Aufnahme)
Wiederholungen über den Ellbogenwinkel; geprüft werden Tiefe (Ellbogen ≤ 90–100°), Körperlinie
(Hüfte hängt durch / Po zu hoch, Abweichung von der Linie Schulter → Knöchel), Strecken der Arme oben,
Kopfhaltung und Tempo. Start per Handzeichen, Pause/Ende durch Aufstehen + Handzeichen.

### Tennis (Aufschlag, Vorhand, Rückhand)
Ohne Schläger-/Balltracking – das Handgelenk der Schlaghand dient als Stellvertreter (Rechts-/Linkshänder wählbar).
Ein Schlag wird an der Geschwindigkeitsspitze des Handgelenks erkannt und automatisch als Aufschlag / Vorhand / Rückhand
klassifiziert; Schläge, die nicht zum gewählten Training passen, werden nicht gewertet.
- **Aufschlag:** Kniebeugung beim Ausholen, gestreckter Arm und Höhe im Treffpunkt, Ballwurfarm, Ausschwung.
  Referenzwerte aus einer Meta-Analyse zur Aufschlag-Kinematik ([Frontiers in Sports and Active Living, 2024](https://www.frontiersin.org/articles/10.3389/fspor.2024.1432030/full)).
- **Vorhand / Rückhand:** Schulterdrehung beim Ausholen (nur von hinten/vorne messbar), Kniebeugung,
  Armhaltung im Treffpunkt (einhändige vs. beidhändige Rückhand), Höhe des Ausschwungs.
- Stopp: **beide** Hände über den Kopf (damit der Aufschlag nicht als Stopp zählt).

Öffentliche Tennis-Datensätze (z. B. THETIS, Kinect-Skelette; „Tennis Player Actions“ auf Mendeley, COCO-Keypoints)
enthalten Schlagarten, aber keine Technikfehler-Labels – daher ist auch die Tennis-Analyse regelbasiert.
Die Schwellwerte sind Startwerte und sollten mit echten Aufnahmen (Export-Funktion) feinjustiert werden.

## Aufbau
```
web/                     PWA (kein Build nötig)
  js/pose.js             MediaPipe-Setup + Skelett-Zeichnung
  js/features.js         Gelenkwinkel & Merkmale aus Landmarks
  js/exercises.js        Übungskatalog: Analyse, Fehlertexte, Anzeige je Übung
  js/squatAnalyzer.js    Kniebeuge: Wiederholungen, Kalibrierung, Regeln (Schwellwerte in THRESHOLDS)
  js/pushupAnalyzer.js   Liegestütz (Schwellwerte in PUSHUP_T)
  js/tennisAnalyzer.js   Tennis: Schlagerkennung + Regeln (Schwellwerte in TENNIS_T)
  js/gesture.js          Handzeichen (Start/Stopp)
  js/cloud.js            Konten + Verlauf (Supabase) mit Offline-Sync
  js/classifier.js       ML-Modell (MLP) im Browser
  js/feedback.js         Feedback-Texte, Tipps, Sprachausgabe
  model/squat_model.json trainiertes Modell
  tests/test.html        Selbsttest mit synthetischen Bewegungen
training/train_model.py  Training auf dem Kaggle-Dataset → web/model/squat_model.json
data/                    Kaggle-Dataset (CC BY-SA 4.0)
```

## Hybrider Ansatz
1. **Regeln** (Hauptquelle für das Feedback): erklärbare Messungen pro Wiederholung, relativ zu einer Kalibrierung im Stand.
2. **ML-Modell** (experimentell): MLP auf dem Kaggle-Dataset
   [Squat Exercise Pose Dataset](https://www.kaggle.com/datasets/thashmiladewmini/squat-exercise-pose-dataset),
   als zusätzliche Einschätzung pro Wiederholung.

**Grenzen des Datasets:** Es enthält nur 15 Videos mit *korrekten* Kniebeugen. Die Fehlerklassen sind synthetisch erzeugt (Winkel wurden um feste Beträge verschoben).
Bei einer Kreuzvalidierung nach Video erreicht das Modell ca. **63 % Accuracy** (Macro-F1 ≈ 0,62).
Die genaue Berechnung der Merkmale im Dataset ist nicht dokumentiert und wurde nachgebaut. Deshalb gibt die App die KI-Einschätzung nur als Hinweis aus.
Für ein besseres Modell braucht es echte, gelabelte Fehlerwiederholungen (siehe nächste Schritte).

## Starten
Lokal am PC:
```bash
python -m http.server 8765 --directory web
```
Dann http://localhost:8765 öffnen. Den Selbsttest gibt es unter http://localhost:8765/tests/test.html.

**Im Heimnetz testen (HTTPS mit selbstsigniertem Zertifikat):**
```bash
.venv\Scripts\python.exe tools\serve_https.py
```

**Online (GitHub Pages):** Jeder Push auf `main` veröffentlicht den Ordner `web/` automatisch über
`.github/workflows/pages.yml`. Nach dem ersten Öffnen funktioniert die App auch offline
(Service Worker cacht App und MediaPipe-Modell).

**Auf dem Handy:** Die Kamera funktioniert nur über **HTTPS**. Am einfachsten lädst du den Ordner `web/` auf GitHub Pages, Netlify oder Cloudflare Pages hoch.
Danach kannst du die Seite im Browser über „Zum Startbildschirm hinzufügen“ wie eine App installieren.

## Modell neu trainieren
Das Kaggle-CSV ist nicht im Repository enthalten. Lade es von Kaggle herunter
(`squat_features_augmented.csv`) und lege es in `data/`.
```bash
pip install pandas scikit-learn numpy
python training/train_model.py --csv data/squat_features_augmented.csv
```

## Nächste Schritte (Ideen)
- Eigene Kniebeugen aufnehmen und labeln. Die App kann dafür später einen Export der Merkmale pro Wiederholung bekommen. Damit lässt sich ein Modell auf echten Fehlern trainieren.
- Schwellwerte in `THRESHOLDS` mit echten Aufnahmen feinjustieren.
- Weitere Übungen (z. B. Liegestütz, Ausfallschritt) als eigene Analyzer nach demselben Muster.
