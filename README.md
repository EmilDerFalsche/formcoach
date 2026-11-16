# FormCoach – Technik-Analyse für Kniebeugen

Web-App (PWA), die mit der Handykamera Kniebeugen analysiert und persönliches Feedback gibt.
Die Gelenkpunkte kommen von **MediaPipe Pose Landmarker**. Alles läuft auf dem Gerät, es wird kein Video hochgeladen.

## Funktionen
- **Live-Training:** Wiederholungszähler, Feedback nach jeder Wiederholung (Text, Sprache, Vibration), fehlerhafte Gelenke werden rot markiert, Tiefenbalken.
- **Video-Analyse:** aufgenommenen Satz hochladen, Bericht pro Wiederholung.
- **Auswertung:** Ø-Score, priorisierte Tipps, Verlauf der Hüfttiefe, Kennzahlen pro Wiederholung, Trainingsverlauf (lokal gespeichert).
- **Erkannte Fehler:** zu wenig Tiefe, zu starke Vorlage, Hüfte kommt zuerst hoch, Knie fallen nach innen, Fersen heben ab, Asymmetrie, zu schnelles Absenken.
  Welche Prüfungen laufen, hängt von der automatisch erkannten Kameraperspektive ab (seitlich, frontal oder diagonal).

## Aufbau
```
web/                     PWA (kein Build nötig)
  js/pose.js             MediaPipe-Setup + Skelett-Zeichnung
  js/features.js         Gelenkwinkel & Merkmale aus Landmarks
  js/squatAnalyzer.js    Wiederholungserkennung, Kalibrierung, Regeln (Schwellwerte in THRESHOLDS)
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
