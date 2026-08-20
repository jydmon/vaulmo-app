#!/usr/bin/env python3
"""
Passport-photo processor (VLT-10).

Turns a casual head-and-shoulders photo into a compliant passport photo:
  1. detect the face (OpenCV Haar cascade),
  2. segment the person from the background (grabCut) and composite onto pure white,
  3. crop/scale so the head sits at the right size and position for a 35x45mm photo,
  4. output a 600x771 JPEG (35:45 ratio, print-ready).

Usage:  passport.py <input> <output>
Prints one line of JSON to stdout: {"facesDetected":N,"width":W,"height":H,"segmented":bool}

No ML model download is needed — Haar cascades and grabCut ship with OpenCV.
Degrades gracefully: if no face is found it still produces a correctly-sized,
white-background photo from a centred crop.
"""
import sys, json
import numpy as np
import cv2

OUT_W, OUT_H = 600, 771            # 35:45 mm at ~440 dpi
HEAD_FRACTION = 0.68               # crown-to-chin as a fraction of photo height (UK: 64-76%)
EYES_FROM_TOP = 0.42               # where the eye line sits vertically


def largest_face(gray):
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
    if len(faces) == 0:
        return None
    # biggest by area
    return max(faces, key=lambda f: f[2] * f[3])


def segment_person(img, rect):
    """grabCut foreground segmentation seeded by a rectangle. Returns a 0/1 mask."""
    mask = np.zeros(img.shape[:2], np.uint8)
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(img, mask, tuple(rect), bgd, fgd, 5, cv2.GC_INIT_WITH_RECT)
    except Exception:
        return None
    m = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 1, 0).astype(np.uint8)
    if m.sum() < 0.02 * m.size:   # segmentation collapsed — treat as failure
        return None
    return m


def composite_white(img, mask):
    """Feather the mask edge and alpha-composite the person onto pure white."""
    alpha = cv2.GaussianBlur((mask * 255).astype(np.uint8), (0, 0), 2.0).astype(np.float32) / 255.0
    alpha = alpha[:, :, None]
    white = np.full_like(img, 255)
    return (img.astype(np.float32) * alpha + white.astype(np.float32) * (1.0 - alpha)).astype(np.uint8)


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: passport.py <input> <output>"})); sys.exit(2)
    inp, out = sys.argv[1], sys.argv[2]
    img = cv2.imread(inp, cv2.IMREAD_COLOR)
    if img is None:
        print(json.dumps({"error": "unreadable_image"})); sys.exit(1)

    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    face = largest_face(gray)
    faces_detected = 1 if face is not None else 0

    # Seed rectangle for grabCut: the whole subject (head + shoulders), or a centred
    # portrait region when there's no detected face.
    if face is not None:
        fx, fy, fw, fh = [int(v) for v in face]
        rx0 = max(0, int(fx - fw * 0.8)); rx1 = min(w, int(fx + fw * 1.8))
        ry0 = max(0, int(fy - fh * 0.9)); ry1 = min(h, int(fy + fh * 3.2))
    else:
        rx0, rx1 = int(w * 0.12), int(w * 0.88)
        ry0, ry1 = int(h * 0.08), int(h * 0.98)
    rect = [rx0, ry0, max(1, rx1 - rx0), max(1, ry1 - ry0)]

    mask = segment_person(img, rect)
    segmented = mask is not None
    canvas = composite_white(img, mask) if segmented else img.copy()
    # When we couldn't segment, still lift a near-uniform background toward white so the
    # result looks passport-like rather than leaving a coloured backdrop untouched.
    if not segmented:
        corners = np.concatenate([canvas[0:8, 0:8].reshape(-1, 3), canvas[0:8, -8:].reshape(-1, 3)])
        bg = np.median(corners, axis=0)
        if np.all(bg > 90):  # only lighten genuinely light backgrounds
            diff = np.linalg.norm(canvas.astype(np.int16) - bg.astype(np.int16), axis=2)
            near = (diff < 40)
            canvas[near] = 255

    # Work out the crop so the head is the right size and position.
    if face is not None:
        fx, fy, fw, fh = [int(v) for v in face]
        head_h = fh * 1.5                      # Haar box ≈ 2/3 of crown-to-chin
        crop_h = head_h / HEAD_FRACTION
        crop_w = crop_h * (OUT_W / OUT_H)
        eye_y = fy + fh * 0.42
        cx = fx + fw / 2.0
        top = eye_y - crop_h * EYES_FROM_TOP
        left = cx - crop_w / 2.0
    else:
        crop_w = min(w, h * (OUT_W / OUT_H))
        crop_h = crop_w * (OUT_H / OUT_W)
        left = (w - crop_w) / 2.0
        top = (h - crop_h) / 2.0

    # Pad the canvas with white if the crop runs off the edges (common when the head is
    # near the top), so we never crop into the subject or leave black borders.
    pad = int(max(crop_w, crop_h))
    canvas = cv2.copyMakeBorder(canvas, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    left += pad; top += pad
    x0, y0 = int(round(left)), int(round(top))
    x1, y1 = int(round(left + crop_w)), int(round(top + crop_h))
    x0, y0 = max(0, x0), max(0, y0)
    crop = canvas[y0:y1, x0:x1]
    if crop.size == 0:
        crop = canvas
    result = cv2.resize(crop, (OUT_W, OUT_H), interpolation=cv2.INTER_AREA)

    cv2.imwrite(out, result, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print(json.dumps({"facesDetected": faces_detected, "width": OUT_W, "height": OUT_H, "segmented": bool(segmented)}))


if __name__ == "__main__":
    main()
