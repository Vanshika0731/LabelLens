🥗 Food Safety Analyzer
📌 Overview
Food Safety Analyzer is a Python-based application that extracts ingredient names from food product labels using OCR and analyzes them against a predefined database to identify potentially harmful ingredients. The system helps users make informed decisions by highlighting ingredients that may be unsafe or require caution.

✨ Features
Extracts text from food label images using OCR.
Identifies ingredients using text preprocessing.
Matches extracted ingredients with a predefined database and if not present in database then predict it using random forest and if the model have confidence in it then it labelled the ingredient after which a threshold is applied if model have confidence above threshold the ingredient is added automatically to the dataset and if not it is kept for manual editing
|≥ 0.80| Auto-appended to CSV + DB, model retrains |
| 0.60 – 0.79| Saved to 'review_log.json' for manual check |
|< 0.60| Discarded — too uncertain |
Displays harmful or cautionary ingredients.

🛠️ Tech Stack
Python
Tesseract OCR
OpenCV
RapidFuzz
Regex
