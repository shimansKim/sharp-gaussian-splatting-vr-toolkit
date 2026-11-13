package com.sharp.questnative.ui;

import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.Shader;
import android.util.Log;
import android.view.Surface;

/**
 * Texture of the controller ray quads: soft-edged white line, the same along its length and
 * symmetric across it, so it looks right whichever way the Surface image is oriented. Owner: ui.
 */
final class RayTexture {
    private RayTexture() {}

    static void draw(Surface surface, int w, int h) {
        if (surface == null || !surface.isValid()) return;
        Canvas c;
        try {
            c = surface.lockHardwareCanvas();
        } catch (Exception e) {
            Log.w("QuestNative", "[ui] ray texture lock failed", e);
            return;
        }
        try {
            c.drawColor(0, PorterDuff.Mode.CLEAR);
            Paint p = new Paint();
            int edge = 0x00DDE8FF, core = 0xE6F2F6FF;
            p.setShader(new LinearGradient(0, 0, w, 0, new int[] {edge, core, core, edge},
                    new float[] {0f, 0.35f, 0.65f, 1f}, Shader.TileMode.CLAMP));
            c.drawRect(0, 0, w, h, p);
        } finally {
            surface.unlockCanvasAndPost(c);
        }
    }
}
