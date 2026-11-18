# Bukva — Russian Sign Language Alphabet

Source: https://github.com/ai-forever/bukva (commit `174b7e3c04336e81ccbb19a4d8ad422fb29cfa6a`)
Weights: `MobileNetV2_TSM.onnx` from the upstream README, shipped unchanged as
`web/public/models/bukva/model.onnx`.

Authors: Karina Kvanchiani, Petr Surovtsev, Alexander Nagaev, Elizaveta Petrova,
Alexander Kapitanov (SberDevices / ai-forever).
Paper: https://arxiv.org/abs/2410.08675

License: "Public license with attribution and conditions reserved" — a reworking of
CC BY-SA 4.0 (not a Creative Commons license). Full text: `LICENSE_en.pdf`, `LICENSE_ru.pdf`.
Provided "as is", without warranties.

Changes by SignTalk: none to the weights. Class labels were copied from upstream
`constants.py`; preprocessing (8 frames, every 2nd frame, 224×224 letterbox with
grey 114 padding, ImageNet mean/std) was re-implemented in TypeScript for the browser.
The Bukva video dataset (~27 GB) is not included.
