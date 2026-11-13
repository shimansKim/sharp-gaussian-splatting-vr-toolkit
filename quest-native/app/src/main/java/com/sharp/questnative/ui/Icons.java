package com.sharp.questnative.ui;

import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;

/**
 * Vector icons named in docs/module-contract.md 14.6, drawn into a square centred on (cx, cy).
 * Unknown names draw nothing (the label still shows). Owner: ui.
 */
final class Icons {
    private Icons() {}

    static boolean has(String name) {
        switch (name) {
            case "play": case "pause": case "back10": case "fwd10": case "prev": case "next": case "list":
            case "more": case "zoomIn": case "zoomOut": case "slideshow": case "volume": case "mute":
            case "loop": case "speed": case "recenter": case "swapEyes": case "diag": case "close":
                return true;
            default:
                return false;
        }
    }

    static void draw(Canvas c, String name, float cx, float cy, float size, int color) {
        Paint fill = Theme.fill(color);
        Paint stroke = Theme.fill(color);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(size * 0.1f);
        stroke.setStrokeCap(Paint.Cap.ROUND);
        stroke.setStrokeJoin(Paint.Join.ROUND);
        float s = size / 2f;
        Path p = new Path();
        switch (name) {
            case "play":
                p.moveTo(cx - s * 0.55f, cy - s * 0.75f);
                p.lineTo(cx + s * 0.75f, cy);
                p.lineTo(cx - s * 0.55f, cy + s * 0.75f);
                p.close();
                c.drawPath(p, fill);
                break;
            case "pause":
                c.drawRect(cx - s * 0.6f, cy - s * 0.7f, cx - s * 0.15f, cy + s * 0.7f, fill);
                c.drawRect(cx + s * 0.15f, cy - s * 0.7f, cx + s * 0.6f, cy + s * 0.7f, fill);
                break;
            case "prev":
            case "next": {
                float d = name.equals("next") ? 1 : -1;
                p.moveTo(cx - d * s * 0.6f, cy - s * 0.6f);
                p.lineTo(cx + d * s * 0.3f, cy);
                p.lineTo(cx - d * s * 0.6f, cy + s * 0.6f);
                p.close();
                c.drawPath(p, fill);
                c.drawRect(Math.min(cx + d * s * 0.4f, cx + d * s * 0.62f), cy - s * 0.6f,
                        Math.max(cx + d * s * 0.4f, cx + d * s * 0.62f), cy + s * 0.6f, fill);
                break;
            }
            case "back10":
            case "fwd10": {
                float d = name.equals("fwd10") ? 1 : -1;
                RectF arc = new RectF(cx - s * 0.7f, cy - s * 0.7f, cx + s * 0.7f, cy + s * 0.7f);
                c.drawArc(arc, d > 0 ? -60 : -120, d * 280, false, stroke);
                Paint t = Theme.text(color, size * 0.38f, true);
                t.setTextAlign(Paint.Align.CENTER);
                c.drawText("10", cx, cy + size * 0.14f, t);
                break;
            }
            case "list":
                for (int i = -1; i <= 1; i++) c.drawLine(cx - s * 0.6f, cy + i * s * 0.5f, cx + s * 0.6f, cy + i * s * 0.5f, stroke);
                break;
            case "more":
                for (int i = -1; i <= 1; i++) c.drawCircle(cx + i * s * 0.55f, cy, size * 0.08f, fill);
                break;
            case "zoomIn":
            case "zoomOut":
                c.drawCircle(cx - s * 0.15f, cy - s * 0.15f, s * 0.5f, stroke);
                c.drawLine(cx + s * 0.22f, cy + s * 0.22f, cx + s * 0.7f, cy + s * 0.7f, stroke);
                c.drawLine(cx - s * 0.4f, cy - s * 0.15f, cx + s * 0.1f, cy - s * 0.15f, stroke);
                if (name.equals("zoomIn")) c.drawLine(cx - s * 0.15f, cy - s * 0.4f, cx - s * 0.15f, cy + s * 0.1f, stroke);
                break;
            case "slideshow":
                c.drawRect(cx - s * 0.75f, cy - s * 0.55f, cx + s * 0.75f, cy + s * 0.55f, stroke);
                p.moveTo(cx - s * 0.2f, cy - s * 0.3f);
                p.lineTo(cx + s * 0.35f, cy);
                p.lineTo(cx - s * 0.2f, cy + s * 0.3f);
                p.close();
                c.drawPath(p, fill);
                break;
            case "volume":
            case "mute":
                p.moveTo(cx - s * 0.7f, cy - s * 0.25f);
                p.lineTo(cx - s * 0.35f, cy - s * 0.25f);
                p.lineTo(cx + s * 0.05f, cy - s * 0.65f);
                p.lineTo(cx + s * 0.05f, cy + s * 0.65f);
                p.lineTo(cx - s * 0.35f, cy + s * 0.25f);
                p.lineTo(cx - s * 0.7f, cy + s * 0.25f);
                p.close();
                c.drawPath(p, fill);
                if (name.equals("mute")) {
                    c.drawLine(cx + s * 0.3f, cy - s * 0.3f, cx + s * 0.75f, cy + s * 0.3f, stroke);
                    c.drawLine(cx + s * 0.75f, cy - s * 0.3f, cx + s * 0.3f, cy + s * 0.3f, stroke);
                } else {
                    c.drawArc(new RectF(cx - s * 0.2f, cy - s * 0.45f, cx + s * 0.6f, cy + s * 0.45f), -50, 100, false, stroke);
                }
                break;
            case "loop": {
                RectF arc = new RectF(cx - s * 0.7f, cy - s * 0.5f, cx + s * 0.7f, cy + s * 0.5f);
                c.drawArc(arc, 200, 300, false, stroke);
                break;
            }
            case "speed": {
                RectF arc = new RectF(cx - s * 0.75f, cy - s * 0.6f, cx + s * 0.75f, cy + s * 0.9f);
                c.drawArc(arc, 180, 180, false, stroke);
                c.drawLine(cx, cy + s * 0.15f, cx + s * 0.4f, cy - s * 0.3f, stroke);
                break;
            }
            case "recenter":
                c.drawCircle(cx, cy, s * 0.55f, stroke);
                c.drawCircle(cx, cy, size * 0.08f, fill);
                break;
            case "swapEyes":
                c.drawLine(cx - s * 0.7f, cy - s * 0.25f, cx + s * 0.7f, cy - s * 0.25f, stroke);
                c.drawLine(cx + s * 0.7f, cy + s * 0.25f, cx - s * 0.7f, cy + s * 0.25f, stroke);
                c.drawLine(cx + s * 0.7f, cy - s * 0.25f, cx + s * 0.4f, cy - s * 0.5f, stroke);
                c.drawLine(cx - s * 0.7f, cy + s * 0.25f, cx - s * 0.4f, cy + s * 0.5f, stroke);
                break;
            case "diag":
                for (int i = 0; i < 3; i++) {
                    float x = cx - s * 0.5f + i * s * 0.5f;
                    c.drawLine(x, cy + s * 0.6f, x, cy + s * 0.6f - (i + 1) * s * 0.4f, stroke);
                }
                break;
            case "close":
                c.drawLine(cx - s * 0.5f, cy - s * 0.5f, cx + s * 0.5f, cy + s * 0.5f, stroke);
                c.drawLine(cx + s * 0.5f, cy - s * 0.5f, cx - s * 0.5f, cy + s * 0.5f, stroke);
                break;
            default:
                break;
        }
    }
}
