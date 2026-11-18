# Authors and third-party notices

This package is a modified educational prototype. Preserve the following notices when copying it. The top-level MIT license applies to the GestureSign code and the new SignTalk code, not automatically to every dataset or weight file.

## GestureSign

Original author: Shashank Yadav. https://github.com/shashank11yadav/GestureSign
Original revision: `ffc0578e68449676b6e9545da82092679914e8c8`.
License: MIT, retained in `LICENSE`. Original documentation: `README_UPSTREAM.md`.
Modified: application shell, RU/KZ localization, translated labels, accessible dialogue, KRSL10 pilot and RSL integration, Windows launchers and documentation. Upstream ASL weights are unchanged.

ASL training data and included ASL replay landmarks: Google Isolated Sign Language Recognition / PopSign (asl-signs), CC BY 4.0 as identified by the upstream model card. https://www.kaggle.com/competitions/asl-signs . The original dataset has not been re-downloaded or repackaged.

## Easy Sign

ai-forever/easy_sign contributors. https://github.com/ai-forever/easy_sign
Retained original `S3D.onnx` and class labels; adapted the inference integration and added a partial Kazakh text-label dictionary. **CC BY-SA 4.0**, full license in `third_party/easy_sign/LICENSE`. Changes to covered material retain the attribution and share-alike terms. The upstream model has not been retrained by this team. Underlying dataset rights are separate; no Slovo video archive is included.

## Bukva (RSL fingerspelling alphabet)

Karina Kvanchiani, Petr Surovtsev, Alexander Nagaev, Elizaveta Petrova, Alexander Kapitanov — ai-forever/bukva. https://github.com/ai-forever/bukva ; https://arxiv.org/abs/2410.08675
Retained the original `MobileNetV2_TSM.onnx` weights unchanged (`web/public/models/bukva/model.onnx`) and the 33-letter class list. Browser preprocessing was re-implemented in TypeScript. **Public license with attribution and conditions reserved** (a reworking of CC BY-SA 4.0, not a Creative Commons license), full text in `third_party/bukva/LICENSE_en.pdf` and `LICENSE_ru.pdf`; details in `third_party/bukva/README.md`. Provided as is. The Bukva video dataset is not included.

## KRSL research source

kurshakuz/krsl-recogniton contributors, upstream Apache 2.0 text retained in `third_party/krsl/LICENSE`.
https://github.com/kurshakuz/krsl-recogniton

Research dataset credit: Mukushev, M., Sabyrov, A., Imashev, A., Koishybay, K., Kimmelman, V. & Sandygulova, A. (2020). Evaluation of Manual and Non-manual Components for Sign Language Recognition. LREC 2020, 6075–6080. https://aclanthology.org/2020.lrec-1.745/ ; https://krslproject.github.io/krsl20/ .

SignTalk trained a new ten-lexeme pilot from the source repository's published absolute hand coordinates; it does not ship the old Keras checkpoint. A small set of derived aggregate vectors is included for transparent testing. The full corpus and participant videos are not included. The research page does not provide a separate explicit license for all source videos; repository and article licenses should not be conflated. See `DATA_SOURCES.md` before redistributing source data.

## Runtimes

- MediaPipe, Google contributors — Apache 2.0. https://github.com/google-ai-edge/mediapipe
- ONNX Runtime, Microsoft contributors — MIT. https://github.com/microsoft/onnxruntime
- React, Meta contributors — MIT. https://github.com/facebook/react
- Vite contributors — MIT. https://github.com/vitejs/vite
- Tailwind CSS contributors — MIT. https://github.com/tailwindlabs/tailwindcss
- Lucide contributors — ISC. https://github.com/lucide-icons/lucide

Exact versions are pinned in `web/package-lock.json`; license texts for shipped runtime packages are copied under `third_party/runtime/` when preparing this release. Model hashes and source revisions are in `third_party/model-manifest.json`.

## Google Gemini API (optional cloud mode)

Version 0.4 optionally sends a user-approved video clip to Google's Gemini Interactions API. No Google model weights are distributed or trained by this team. Provider terms apply independently. The local models above remain available. Credentials are server-only and excluded from release archives.

## Lip reading: Chaplin and Auto-AVSR

Inference code in `lipread/` (the `espnet/` and `pipelines/` folders and `configs/LRS3_V_WER19.1.ini`) is copied from Chaplin by Amanvir Parhar, https://github.com/amanvirparhar/chaplin , **MIT**, text in `lipread/LICENSE.chaplin`. Chaplin in turn contains code by Pingchuan Ma (Imperial College London) from Auto-AVSR / Visual Speech Recognition for Multiple Languages, https://github.com/mpc001/auto_avsr , **Apache 2.0** (headers kept in each file), and ESPnet code, **Apache 2.0**.
Modified: the RetinaFace detector, noise files, keyboard typing and LLM correction were removed; detection failures raise errors instead of asserts; the CTC prefix scorer follows the input device so the model can run on Apple MPS. `lipread/server.py` (HTTP service) is new SignTalk code.
Model weights `LRS3_V_WER19.1` and `lm_en_subword` are downloaded by `npm run lipread:setup` from https://huggingface.co/Amanvir and are not included in the package. They were trained on LRS3 (and related audio-visual datasets), whose licence allows **non-commercial research use only**; check the terms before any commercial use. Reference: Ma, P. et al. (2023). Auto-AVSR: Audio-Visual Speech Recognition with Automatic Labels. ICASSP 2023.
