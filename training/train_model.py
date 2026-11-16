"""
Trainiert einen kleinen Klassifikator (MLP) auf dem Kaggle-Dataset
"Squat Exercise Pose Dataset" (thashmiladewmini/squat-exercise-pose-dataset)
und exportiert ihn als JSON, damit die Web-App ihn direkt im Browser ausführen kann.

Aufruf:
    python training/train_model.py --csv data/squat_features_augmented.csv

Ausgabe:
    web/model/squat_model.json
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from sklearn.model_selection import GroupKFold
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler

# Reihenfolge MUSS mit web/js/features.js (FEATURE_ORDER) übereinstimmen.
FEATURES = [
    "left_knee_angle", "right_knee_angle",
    "left_hip_angle", "right_hip_angle",
    "left_ankle_angle", "right_ankle_angle",
    "spine_angle", "torso_lean",
    "left_knee_lateral", "right_knee_lateral",
    "symmetry_score", "hip_depth",
]
LABELS = ["correct", "shallow", "forward_lean", "knees_in", "heels_up", "asymmetric"]


def make_model():
    return MLPClassifier(hidden_layer_sizes=(64, 32), activation="relu",
                         alpha=1e-3, max_iter=400, early_stopping=True,
                         random_state=42)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "web" / "model" / "squat_model.json"))
    args = ap.parse_args()

    df = pd.read_csv(args.csv).dropna(subset=FEATURES + ["label"])
    X = df[FEATURES].to_numpy(dtype=np.float64)
    y = df["label"].to_numpy(dtype=int)
    groups = df["video_file"].to_numpy()
    print(f"{len(df)} Zeilen, {len(np.unique(groups))} Videos")

    # Evaluation mit Gruppen-Split nach Video, damit keine Frames desselben
    # Videos gleichzeitig in Training und Test landen (sonst Datenleck).
    y_true, y_pred = [], []
    for fold, (tr, te) in enumerate(GroupKFold(n_splits=5).split(X, y, groups)):
        sc = StandardScaler().fit(X[tr])
        m = make_model().fit(sc.transform(X[tr]), y[tr])
        p = m.predict(sc.transform(X[te]))
        y_true.append(y[te]); y_pred.append(p)
        print(f"Fold {fold}: macro-F1 = {f1_score(y[te], p, average='macro'):.3f}")
    y_true = np.concatenate(y_true); y_pred = np.concatenate(y_pred)
    report = classification_report(y_true, y_pred, target_names=LABELS, output_dict=True)
    print(classification_report(y_true, y_pred, target_names=LABELS))
    print("Konfusionsmatrix:\n", confusion_matrix(y_true, y_pred))

    # Finales Modell auf allen Daten
    sc = StandardScaler().fit(X)
    m = make_model().fit(sc.transform(X), y)

    out = {
        "version": 1,
        "source": "kaggle: thashmiladewmini/squat-exercise-pose-dataset (CC BY-SA 4.0)",
        "features": FEATURES,
        "labels": LABELS,
        "scaler": {"mean": sc.mean_.tolist(), "scale": sc.scale_.tolist()},
        "layers": [
            {"W": W.T.tolist(), "b": b.tolist()}  # W: [out][in]
            for W, b in zip(m.coefs_, m.intercepts_)
        ],
        "activation": "relu",
        "cv_metrics": {
            "macro_f1": report["macro avg"]["f1-score"],
            "accuracy": report["accuracy"],
            "per_class_f1": {k: report[k]["f1-score"] for k in LABELS},
        },
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out), encoding="utf-8")
    print(f"Modell gespeichert: {args.out}")

    # Referenzvorhersagen für den JS-Selbsttest (web/tests/test.html)
    idx = np.random.default_rng(0).choice(len(X), 20, replace=False)
    ref = [{"x": X[i].tolist(), "p": m.predict_proba(sc.transform(X[i:i + 1]))[0].tolist()} for i in idx]
    ref_path = Path(args.out).parents[1] / "tests" / "classifier_reference.json"
    ref_path.parent.mkdir(parents=True, exist_ok=True)
    ref_path.write_text(json.dumps(ref), encoding="utf-8")


if __name__ == "__main__":
    main()
