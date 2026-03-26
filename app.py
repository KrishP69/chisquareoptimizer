import io
import os
import base64
from datetime import datetime

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from flask import Flask, jsonify, render_template, request
from scipy.stats import chi2_contingency

app = Flask(__name__)


def parse_manual_table(raw_text: str) -> np.ndarray:
    rows = [line.strip() for line in raw_text.splitlines() if line.strip()]
    if not rows:
        raise ValueError("Manual input is empty.")

    parsed = []
    width = None
    for row in rows:
        parts = [p.strip() for p in row.split(",")]
        if width is None:
            width = len(parts)
        if len(parts) != width:
            raise ValueError("All rows must have the same number of columns.")
        try:
            parsed.append([float(v) for v in parts])
        except ValueError as exc:
            raise ValueError("Manual input must contain numeric values only.") from exc

    return np.array(parsed, dtype=float)


def parse_csv_table(file_storage) -> np.ndarray:
    if not file_storage or file_storage.filename == "":
        raise ValueError("No CSV file uploaded.")

    raw = file_storage.read()
    file_storage.seek(0)
    if not raw:
        raise ValueError("Uploaded CSV is empty.")

    try:
        df = pd.read_csv(io.BytesIO(raw), header=None)
    except Exception as exc:
        raise ValueError("Invalid CSV format.") from exc

    if df.empty:
        raise ValueError("Uploaded CSV has no rows.")

    numeric_df = df.apply(pd.to_numeric, errors="coerce")
    if numeric_df.isna().any().any():
        raise ValueError("CSV contains non-numeric values.")

    return numeric_df.to_numpy(dtype=float)


def validate_contingency_table(table: np.ndarray):
    if table.ndim != 2:
        raise ValueError("Input must be a 2D contingency table.")
    if table.shape[0] < 2 or table.shape[1] < 2:
        raise ValueError("Chi-square test requires at least a 2x2 table.")
    if np.any(table < 0):
        raise ValueError("Negative values are not allowed.")
    if np.any(table.sum(axis=1) == 0) or np.any(table.sum(axis=0) == 0):
        raise ValueError("Each row and column must have a non-zero sum.")


def run_chi_square(observed: np.ndarray):
    chi2, p_value, dof, expected = chi2_contingency(observed)
    warning = bool((expected < 5).any())
    hypothesis = "Reject H0" if p_value < 0.05 else "Fail to Reject H0"
    return {
        "chi2": float(chi2),
        "p_value": float(p_value),
        "dof": int(dof),
        "expected": expected,
        "warning": warning,
        "hypothesis": hypothesis,
    }


def create_chart(observed: np.ndarray, expected: np.ndarray, prefix: str) -> str:
    row_labels = [f"R{i + 1}" for i in range(observed.shape[0])]
    obs_totals = observed.sum(axis=1)
    exp_totals = expected.sum(axis=1)

    x = np.arange(len(row_labels))
    width = 0.36

    fig, ax = plt.subplots(figsize=(9, 5.2))
    ax.bar(x - width / 2, obs_totals, width=width, color="#06b6d4", label="Observed", alpha=0.92)
    ax.bar(x + width / 2, exp_totals, width=width, color="#818cf8", label="Expected", alpha=0.92)

    ax.set_title("Observed vs Expected Frequencies", fontsize=13, fontweight="bold")
    ax.set_xlabel("Table Rows")
    ax.set_ylabel("Frequency")
    ax.set_xticks(x)
    ax.set_xticklabels(row_labels)
    ax.legend()
    ax.grid(axis="y", alpha=0.2)

    fig.tight_layout()
    buffer = io.BytesIO()
    fig.savefig(buffer, format="png", dpi=120)
    plt.close(fig)
    buffer.seek(0)
    encoded = base64.b64encode(buffer.read()).decode("utf-8")
    return f"data:image/png;base64,{encoded}"


def round_table(table: np.ndarray):
    return np.round(table, 4).tolist()


def optimize_observed(observed: np.ndarray, expected: np.ndarray):
    optimized = 0.35 * observed + 0.65 * expected
    optimized = np.clip(optimized, 0.0001, None)
    return optimized


@app.get("/")
def home():
    return render_template("index.html")


@app.post("/analyze")
def analyze():
    try:
        file_obj = request.files.get("csvFile")
        manual_data = request.form.get("manualData", "").strip()

        if file_obj and file_obj.filename:
            observed = parse_csv_table(file_obj)
        elif manual_data:
            observed = parse_manual_table(manual_data)
        else:
            return jsonify({"ok": False, "error": "Upload a CSV or enter manual table values."}), 400

        validate_contingency_table(observed)

        stats = run_chi_square(observed)
        chart_url = create_chart(observed, stats["expected"], "analysis")

        payload = {
            "mode": "analysis",
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "chi2": round(stats["chi2"], 6),
            "p_value": round(stats["p_value"], 6),
            "dof": stats["dof"],
            "hypothesis": stats["hypothesis"],
            "warning": stats["warning"],
            "warning_message": "Warning: Expected cell frequency below 5 detected. Test assumptions may be weak." if stats["warning"] else "",
            "observed": round_table(observed),
            "expected": round_table(stats["expected"]),
            "chart_url": chart_url,
        }

        html = render_template("result.html", payload=payload)
        return jsonify({"ok": True, "payload": payload, "html": html, "observed": payload["observed"]})

    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception:
        return jsonify({"ok": False, "error": "Unexpected server error while analyzing data."}), 500


@app.post("/optimize")
def optimize():
    try:
        data = request.get_json(silent=True) or {}
        observed_list = data.get("observed")
        if observed_list is None:
            return jsonify({"ok": False, "error": "Observed table is required for optimization."}), 400

        observed = np.array(observed_list, dtype=float)
        validate_contingency_table(observed)

        before = run_chi_square(observed)
        optimized = optimize_observed(observed, before["expected"])
        after = run_chi_square(optimized)

        if after["chi2"] > before["chi2"]:
            optimized = before["expected"].copy()
            after = run_chi_square(optimized)

        before_chart = create_chart(observed, before["expected"], "before")
        after_chart = create_chart(optimized, after["expected"], "after")

        payload = {
            "mode": "optimization",
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "before": {
                "chi2": round(before["chi2"], 6),
                "p_value": round(before["p_value"], 6),
                "dof": before["dof"],
                "hypothesis": before["hypothesis"],
            },
            "after": {
                "chi2": round(after["chi2"], 6),
                "p_value": round(after["p_value"], 6),
                "dof": after["dof"],
                "hypothesis": after["hypothesis"],
            },
            "improvement": round(before["chi2"] - after["chi2"], 6),
            "warning": before["warning"] or after["warning"],
            "warning_message": "Warning: Expected cell frequency below 5 detected in one or more states." if (before["warning"] or after["warning"]) else "",
            "optimized": round_table(optimized),
            "before_chart_url": before_chart,
            "after_chart_url": after_chart,
        }

        html = render_template("result.html", payload=payload)
        return jsonify({"ok": True, "payload": payload, "html": html})

    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception:
        return jsonify({"ok": False, "error": "Unexpected server error while optimizing data."}), 500


if __name__ == "__main__":
    app.run(debug=True)
