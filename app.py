from flask import Flask, request, jsonify, render_template
from werkzeug.utils import secure_filename
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
import io, json, re, os, shutil
import joblib

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Load the existing saved model and database once when Flask starts.
MODEL_PATH = os.path.join(BASE_DIR, "food_classifier.pkl")
DB_CANDIDATES = [
    os.path.join(BASE_DIR, "food_master_db.json"),
    os.path.join(BASE_DIR, "food_master_db (1).json"),
]
DB_PATH = next((p for p in DB_CANDIDATES if os.path.exists(p)), None)

clf_model = None
master_db = {}
synonym_index = {}

try:
    if os.path.exists(MODEL_PATH):
        clf_model = joblib.load(MODEL_PATH)
    if DB_PATH:
        with open(DB_PATH, "r", encoding="utf-8") as f:
            master_db = json.load(f)

    for canonical, info in master_db.items():
        canonical = canonical.strip().lower()
        synonym_index[canonical] = canonical
        e_number = str(info.get("e_number", "") or "").strip().lower()
        if e_number:
            synonym_index[e_number] = canonical
        aliases = str(info.get("synonyms_india", "") or "")
        for alias in aliases.split("|"):
            alias = alias.strip().lower()
            if len(alias) >= 2:
                synonym_index[alias] = canonical
except Exception:
    app.logger.exception("Could not load the saved model/database")


@app.get("/")
def home():
    return render_template("index.html")


def normalise(raw):
    if not isinstance(raw, str) or not raw.strip():
        return ""
    n = raw.strip().lower()
    n = re.sub(r"\brn\b", "m", n)
    n = re.sub(r"(?<=[a-z])0(?=[a-z])", "o", n)
    n = re.sub(r"(?<=[a-z])1(?=[a-z])", "l", n)
    n = re.sub(r"(?<=[a-z])5(?=[a-z])", "s", n)
    n = re.sub(r"[^a-z0-9\s\-]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    if n in synonym_index:
        return synonym_index[n]
    for alias, canonical in synonym_index.items():
        if len(alias) >= 4 and alias in n:
            return canonical
    return n


def split_ingredients(raw_text):
    text = re.sub(
        r"(ingredients|contains|composition|ingr[eé]dients)\s*[:\-]?\s*",
        "", raw_text, flags=re.IGNORECASE
    )
    chunks = re.split(r"[,;\n•|/]+", text.lower())
    cleaned = []
    for chunk in chunks:
        chunk = re.sub(r"\(.*?\)", " ", chunk)
        chunk = re.sub(r"[^a-z0-9\s\-]", " ", chunk)
        chunk = re.sub(r"\s+", " ", chunk).strip()
        if len(chunk) >= 2:
            cleaned.append(chunk)
    return cleaned


def classify_one(raw_name):
    original = str(raw_name).strip().lower()
    canon = normalise(original)

    if canon in master_db:
        info = master_db[canon]
        return {
            **info, "label": info.get("label", "Unknown"),
            "confidence": 1.0, "method": "exact match"
        }

    # Fuzzy matching, like the notebook's 82% threshold.
    try:
        from rapidfuzz import process, fuzz
        hit = process.extractOne(canon, list(master_db.keys()), scorer=fuzz.ratio)
        if hit and hit[1] >= 82:
            info = master_db[hit[0]]
            return {
                **info, "label": info.get("label", "Unknown"),
                "confidence": hit[1] / 100, "method": f"fuzzy match ({hit[1]}%)"
            }
    except ImportError:
        from difflib import SequenceMatcher
        best = max(master_db.keys(), key=lambda k: SequenceMatcher(None, canon, k).ratio(), default=None)
        score = SequenceMatcher(None, canon, best).ratio() if best else 0
        if best and score >= 0.82:
            info = master_db[best]
            return {
                **info, "label": info.get("label", "Unknown"),
                "confidence": score, "method": f"fuzzy match ({round(score*100)}%)"
            }

    if clf_model is None:
        return {"label": "Unknown", "category": "Unmatched", "e_number": "",
                "synonyms_india": "", "confidence": 0.0, "method": "model unavailable"}

    # Keep the notebook's existing prediction call.
    try:
        probabilities = clf_model.predict_proba([canon])[0]
        classes = clf_model.classes_
        idx = int(probabilities.argmax())
        label = str(classes[idx])
        confidence = float(probabilities[idx])
    except Exception:
        app.logger.exception("Model prediction failed for ingredient %s", canon)
        return {"label": "Unknown", "category": "Unmatched", "e_number": "",
                "synonyms_india": "", "confidence": 0.0, "method": "prediction error"}

    return {
        "label": label, "category": "ML-predicted", "e_number": "",
        "synonyms_india": "", "confidence": confidence, "method": "ml_model"
    }


def preprocess_for_ocr(image_bytes):
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    # Enlarge the image while preserving its proportions
    if image.width < 1800:
        ratio = 1800 / image.width
        image = image.resize(
            (1800, int(image.height * ratio)),
            Image.Resampling.LANCZOS
        )

    # Convert to grayscale
    image = ImageOps.grayscale(image)

    # Improve contrast without aggressive sharpening
    image = ImageEnhance.Contrast(image).enhance(1.5)

    return image


def status_for_label(label):
    return {
        "Green": "Safe (model label: Green)",
        "Yellow": "Moderate (model label: Yellow)",
        "Orange": "Caution (model label: Orange)",
        "Red": "High concern (model label: Red)",
    }.get(label, "Unknown")


def analyze_ingredient_image(image_bytes, filename):
    if clf_model is None:
        raise RuntimeError("food_classifier.pkl could not be loaded. Check that it is beside app.py.")
    if not master_db:
        raise RuntimeError("Ingredient database JSON could not be loaded. Check its filename beside app.py.")

    try:
        import pytesseract
    except ImportError as exc:
        raise RuntimeError("Python package pytesseract is not installed. Run: python -m pip install pytesseract") from exc

    # Tesseract itself is a separate Windows application.
    if not shutil.which("tesseract") and not os.path.exists(r"C:\Program Files\Tesseract-OCR\tesseract.exe"):
        raise RuntimeError("Tesseract OCR engine is not installed or not on PATH. Install it, then restart the terminal.")

    tesseract_exe = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    if not shutil.which("tesseract") and os.path.exists(tesseract_exe):
        pytesseract.pytesseract.tesseract_cmd = tesseract_exe

    image = preprocess_for_ocr(image_bytes)
    text6 = pytesseract.image_to_string(
        image, config="--oem 3 --psm 6 -l eng"
    )
    text3 = pytesseract.image_to_string(
        image, config="--oem 3 --psm 3 -l eng"
    )

    print("\n--- OCR PSM 6 ---\n", repr(text6))
    print("\n--- OCR PSM 3 ---\n", repr(text3))

    raw_text = text6 if len(text6) >= len(text3) else text3
    print("\n--- SELECTED OCR TEXT ---\n", repr(raw_text))

    if not raw_text.strip():
        raise ValueError("No text could be read. Try a closer, sharper photo of the ingredient list.")
    if not raw_text.strip():
        raise ValueError("No text could be read. Try a closer, sharper photo of the ingredient list.")

    tokens = split_ingredients(raw_text)
    if not tokens:
        raise ValueError("Text was detected, but no ingredients could be separated. Try cropping to the ingredient list.")

    results = {}
    for token in tokens:
        # Do not automatically learn, write to the CSV, or retrain from web uploads.
        results[token] = classify_one(token)

    labels = [r.get("label", "Unknown") for r in results.values()]
    counts = {label: labels.count(label) for label in ("Green", "Yellow", "Orange", "Red")}
    if "Red" in labels:
        overall = "High concern — model classified at least one ingredient as Red"
    elif "Orange" in labels:
        overall = "Caution — model classified at least one ingredient as Orange"
    elif "Yellow" in labels:
        overall = "Moderate — model classified at least one ingredient as Yellow"
    elif labels and all(label == "Green" for label in labels):
        overall = "Lower concern according to the model"
    else:
        overall = "Review needed — some ingredients could not be classified"

    ingredients = []
    for name, info in results.items():
        label = info.get("label", "Unknown")
        ingredients.append({
            "name": name,
            "status": status_for_label(label),
            "reason": f"Model label: {label}. Match method: {info.get('method', 'unknown')}; confidence: {info.get('confidence', 0):.0%}. This is an estimate, not a guarantee of food safety."
        })

    classified = [r.get("confidence", 0) for r in results.values() if r.get("label") in ("Green", "Yellow", "Orange", "Red")]
    score = round(sum(classified) / len(classified), 3) if classified else None
    return {
        "overall_status": overall,
        "summary": f"Read {len(ingredients)} ingredient entries from the label. The results reflect the saved model's classifications, not a medical or definitive safety assessment.",
        "score": score,
        "ingredients": ingredients,
        "recommendation": "Check the full package, serving size, and allergen statement. OCR can misread text; verify ingredient names before relying on this estimate.",
        "model_name": "Existing TF-IDF + Random Forest classifier"
    }


@app.post("/analyze")
def analyze():
    image = request.files.get("image")
    if image is None or not image.filename:
        return jsonify(error="Please upload an ingredient label image."), 400
    filename = secure_filename(image.filename)
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in ALLOWED_EXTENSIONS:
        return jsonify(error="Unsupported image type. Use JPG, PNG, or WEBP."), 400
    image_bytes = image.read()
    if not image_bytes:
        return jsonify(error="The uploaded image is empty."), 400
    try:
        return jsonify(analyze_ingredient_image(image_bytes, filename))
    except (ValueError, RuntimeError) as exc:
        return jsonify(error=str(exc)), 400
    except Exception:
        app.logger.exception("Food safety analysis failed")
        return jsonify(error="Analysis failed. Check the Flask terminal for the detailed error."), 500


if __name__ == "__main__":
    app.run(debug=True)
