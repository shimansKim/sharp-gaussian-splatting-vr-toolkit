package com.sharp.questnative.image;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapRegionDecoder;
import android.graphics.Canvas;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Rect;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.system.Os;
import android.system.OsConstants;
import android.util.Log;
import android.view.Surface;

import java.io.File;
import java.io.FileDescriptor;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Java half of the image viewer (cpp/image/image_viewer.cpp). Owner: image-dev.
 *
 * <p>The native side calls the static methods below on the render thread; they only queue work on
 * one worker thread and return. Results go back through the native* callbacks, which the native
 * side moves to the render thread.
 *
 * <p>Decoding uses only the Android framework: BitmapFactory with inSampleSize for pictures that fit
 * the memory budget, BitmapRegionDecoder strips (decode a band, scale it into the target, free it)
 * for very large pictures and for zoom crops. EXIF rotation is applied here, so the native side
 * always sees upright sizes. Each decoded bitmap is drawn once into the layer's Surface and freed
 * right away: at most one full-size bitmap lives at a time.
 */
public final class ImageBridge {
    private static final String TAG = "QuestNative";
    /** Largest bitmap BitmapFactory may produce before scaling; bigger work goes through strips. */
    private static final long DECODE_BUDGET_PIXELS = 24L * 1024 * 1024;
    /** Pixels decoded per strip in the region path. */
    private static final long STRIP_PIXELS = 4L * 1024 * 1024;
    /** Size of the brightness thumbnail sent to native for the stereo sniff. */
    private static final int LUMA_W = 256, LUMA_H = 128;

    private static final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "qn-image");
        t.setPriority(Thread.NORM_PRIORITY - 1);
        return t;
    });

    private static Context appContext;

    /** One opened picture (token from native). Touched only on the worker thread. */
    private static final class Source {
        String uri;
        String path;              // file path when known
        ParcelFileDescriptor pfd; // when opened from a fd or content:// uri
        int rawW, rawH;           // as stored
        int rotation;             // EXIF degrees (0, 90, 180, 270)
        boolean flip;             // EXIF mirrored orientations
        String mime;
    }

    private static final Map<Long, Source> sources = new HashMap<>();
    private static final Map<Long, Bitmap> decoded = new HashMap<>(); // key = token ^ (job << 40)

    private ImageBridge() {}

    static void init(Context context) {
        appContext = context.getApplicationContext();
    }

    private static long jobKey(long token, int job) {
        return token ^ ((long) job << 40);
    }

    // ------------------------------------------------------------------ called from native

    static void probe(long token, String uri, int fd, String name) {
        worker.execute(() -> {
            try {
                Source s = open(uri, fd);
                BitmapFactory.Options o = new BitmapFactory.Options();
                o.inJustDecodeBounds = true;
                decodeFull(s, o);
                if (o.outWidth <= 0 || o.outHeight <= 0) throw new IllegalStateException("지원하지 않는 그림 형식이에요");
                s.rawW = o.outWidth;
                s.rawH = o.outHeight;
                s.mime = o.outMimeType;
                readExif(s);
                sources.put(token, s);
                boolean sideways = s.rotation == 90 || s.rotation == 270;
                Log.i(TAG, "[image] probe " + name + " " + s.rawW + "x" + s.rawH + " " + s.mime + " rot " + s.rotation);
                nativeProbed(token, sideways ? s.rawH : s.rawW, sideways ? s.rawW : s.rawH, null);
            } catch (Throwable t) {
                Log.w(TAG, "[image] probe failed: " + name, t);
                nativeProbed(token, 0, 0, message(t, "파일을 열지 못했어요"));
            }
        });
    }

    /** Decodes the crop (upright pixels) of the picture into exactly outW x outH. */
    static void decode(long token, int job, int outW, int outH, int cropX, int cropY, int cropW, int cropH) {
        worker.execute(() -> {
            long started = SystemClock.uptimeMillis();
            try {
                Source s = sources.get(token);
                if (s == null) throw new IllegalStateException("closed");
                Bitmap bmp = decodeTo(s, outW, outH, new Rect(cropX, cropY, cropX + cropW, cropY + cropH));
                byte[] luma = luma(bmp);
                decoded.put(jobKey(token, job), bmp);
                int ms = (int) (SystemClock.uptimeMillis() - started);
                Log.i(TAG, "[image] decoded job " + job + " " + bmp.getWidth() + "x" + bmp.getHeight() + " in " + ms + " ms");
                nativeDecoded(token, job, bmp.getWidth(), bmp.getHeight(), luma, LUMA_W, LUMA_H, ms, null);
            } catch (OutOfMemoryError e) {
                Log.w(TAG, "[image] decode out of memory", e);
                nativeDecoded(token, job, 0, 0, null, 0, 0, 0, "메모리가 부족해 그림을 풀지 못했어요");
            } catch (Throwable t) {
                Log.w(TAG, "[image] decode failed", t);
                nativeDecoded(token, job, 0, 0, null, 0, 0, 0, message(t, "그림을 풀지 못했어요"));
            }
        });
    }

    /** Draws the decoded bitmap once into the layer Surface, then frees the bitmap. */
    static void draw(long token, int job, Surface surface) {
        worker.execute(() -> {
            Bitmap bmp = decoded.remove(jobKey(token, job));
            if (bmp == null) {
                nativeDrawn(token, job, false, "그림이 이미 지워졌어요");
                return;
            }
            try {
                Canvas canvas;
                try {
                    canvas = surface.lockHardwareCanvas();
                } catch (Throwable hw) {
                    Log.w(TAG, "[image] lockHardwareCanvas failed, using software canvas", hw);
                    canvas = surface.lockCanvas(null);
                }
                try {
                    Paint paint = new Paint(Paint.FILTER_BITMAP_FLAG);
                    canvas.drawBitmap(bmp, null, new Rect(0, 0, canvas.getWidth(), canvas.getHeight()), paint);
                } finally {
                    surface.unlockCanvasAndPost(canvas);
                }
                nativeDrawn(token, job, true, null);
            } catch (Throwable t) {
                Log.w(TAG, "[image] draw failed", t);
                nativeDrawn(token, job, false, message(t, "그림을 레이어에 올리지 못했어요"));
            } finally {
                bmp.recycle();
            }
        });
    }

    static void drop(long token, int job) {
        worker.execute(() -> {
            Bitmap bmp = decoded.remove(jobKey(token, job));
            if (bmp != null) bmp.recycle();
        });
    }

    /** Closes the picture: file handle and any bitmaps still waiting for this token. */
    static void release(long token) {
        worker.execute(() -> {
            Source s = sources.remove(token);
            if (s != null && s.pfd != null) {
                try {
                    s.pfd.close();
                } catch (Exception ignored) {
                }
            }
            decoded.entrySet().removeIf(e -> {
                boolean mine = (e.getKey() & ((1L << 40) - 1)) == (token & ((1L << 40) - 1));
                if (mine) e.getValue().recycle();
                return mine;
            });
        });
    }

    /** Temporary playlist: pictures in the same folder as uri (file paths only), natural order. */
    static void listFolder(long token, String uri) {
        worker.execute(() -> {
            String path = pathOf(uri);
            if (path == null) {
                nativeFolder(token, new String[0], new String[0]);
                return;
            }
            File[] files = new File(path).getParentFile() != null ? new File(path).getParentFile().listFiles() : null;
            ArrayList<File> images = new ArrayList<>();
            if (files != null) {
                for (File f : files) {
                    if (f.isFile() && isImageName(f.getName())) images.add(f);
                }
            }
            images.sort((a, b) -> naturalCompare(a.getName(), b.getName()));
            String[] uris = new String[images.size()];
            String[] names = new String[images.size()];
            for (int i = 0; i < images.size(); i++) {
                uris[i] = sameStyle(uri, images.get(i));
                names[i] = images.get(i).getName();
            }
            nativeFolder(token, uris, names);
        });
    }

    static String getPref(String key) {
        if (appContext == null) return "";
        return prefs().getString(key, "");
    }

    static void putPref(String key, String value) {
        if (appContext == null) return;
        prefs().edit().putString(key, value).apply();
    }

    // ------------------------------------------------------------------ callbacks into native

    private static native void nativeProbed(long token, int width, int height, String error);

    private static native void nativeDecoded(long token, int job, int width, int height, byte[] luma, int lumaW,
                                             int lumaH, int millis, String error);

    private static native void nativeDrawn(long token, int job, boolean ok, String error);

    private static native void nativeFolder(long token, String[] uris, String[] names);

    // ------------------------------------------------------------------ helpers

    private static SharedPreferences prefs() {
        return appContext.getSharedPreferences("image-viewer", Context.MODE_PRIVATE);
    }

    private static String message(Throwable t, String fallback) {
        String m = t.getMessage();
        return m != null && !m.isEmpty() && !m.equals("closed") && containsHangul(m) ? m : fallback;
    }

    private static boolean containsHangul(String s) {
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c >= 0xAC00 && c <= 0xD7A3) return true;
        }
        return false;
    }

    static String pathOf(String uri) {
        if (uri == null || uri.isEmpty()) return null;
        if (uri.startsWith("/")) return uri;
        if (uri.startsWith("file:")) return Uri.parse(uri).getPath();
        return null;
    }

    private static String sameStyle(String original, File f) {
        return original.startsWith("file:") ? Uri.fromFile(f).toString() : f.getAbsolutePath();
    }

    private static Source open(String uri, int fd) throws Exception {
        Source s = new Source();
        s.uri = uri;
        if (fd >= 0) {
            s.pfd = ParcelFileDescriptor.adoptFd(fd);
        } else {
            s.path = pathOf(uri);
            if (s.path == null) {
                if (uri != null && uri.startsWith("content:") && appContext != null) {
                    s.pfd = appContext.getContentResolver().openFileDescriptor(Uri.parse(uri), "r");
                } else {
                    throw new IllegalArgumentException("이 주소는 아직 열 수 없어요: " + uri);
                }
            } else if (!new File(s.path).canRead()) {
                throw new IllegalArgumentException("파일을 읽을 수 없어요(권한 또는 경로)");
            }
        }
        return s;
    }

    private static FileDescriptor rewind(Source s) throws Exception {
        FileDescriptor fd = s.pfd.getFileDescriptor();
        Os.lseek(fd, 0, OsConstants.SEEK_SET);
        return fd;
    }

    private static Bitmap decodeFull(Source s, BitmapFactory.Options o) throws Exception {
        if (s.path != null) return BitmapFactory.decodeFile(s.path, o);
        return BitmapFactory.decodeFileDescriptor(rewind(s), null, o);
    }

    private static BitmapRegionDecoder regionDecoder(Source s) {
        try {
            if (s.path != null) return BitmapRegionDecoder.newInstance(s.path);
            return BitmapRegionDecoder.newInstance(rewind(s), false);
        } catch (Throwable t) {
            return null; // e.g. GIF, BMP, AVIF: not supported by the region decoder
        }
    }

    private static void readExif(Source s) {
        try {
            ExifInterface exif = s.path != null ? new ExifInterface(s.path) : new ExifInterface(rewind(s));
            int o = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            switch (o) {
                case ExifInterface.ORIENTATION_ROTATE_90: s.rotation = 90; break;
                case ExifInterface.ORIENTATION_ROTATE_180: s.rotation = 180; break;
                case ExifInterface.ORIENTATION_ROTATE_270: s.rotation = 270; break;
                case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: s.flip = true; break;
                case ExifInterface.ORIENTATION_FLIP_VERTICAL: s.rotation = 180; s.flip = true; break;
                case ExifInterface.ORIENTATION_TRANSPOSE: s.rotation = 90; s.flip = true; break;
                case ExifInterface.ORIENTATION_TRANSVERSE: s.rotation = 270; s.flip = true; break;
                default: break;
            }
        } catch (Throwable ignored) {
            // No EXIF (PNG, WebP without EXIF ...): upright.
        }
    }

    /** Maps an upright crop rect to the stored (raw) pixel rect. */
    private static Rect toRaw(Source s, Rect up) {
        int uw = (s.rotation == 90 || s.rotation == 270) ? s.rawH : s.rawW;
        Rect r = new Rect(up);
        if (s.flip) r.set(uw - up.right, up.top, uw - up.left, up.bottom); // undo the mirror first
        switch (s.rotation) {
            case 90:  return new Rect(r.top, s.rawH - r.right, r.bottom, s.rawH - r.left);
            case 180: return new Rect(s.rawW - r.right, s.rawH - r.bottom, s.rawW - r.left, s.rawH - r.top);
            case 270: return new Rect(s.rawW - r.bottom, r.left, s.rawW - r.top, r.right);
            default:  return r;
        }
    }

    private static Bitmap decodeTo(Source s, int outW, int outH, Rect upCrop) throws Exception {
        boolean sideways = s.rotation == 90 || s.rotation == 270;
        int upW = sideways ? s.rawH : s.rawW, upH = sideways ? s.rawW : s.rawH;
        if (upCrop.width() <= 0 || upCrop.height() <= 0) upCrop = new Rect(0, 0, upW, upH);
        Rect raw = toRaw(s, upCrop);
        raw.intersect(0, 0, s.rawW, s.rawH);
        // Output size in raw orientation.
        int rawOutW = sideways ? outH : outW, rawOutH = sideways ? outW : outH;
        int sample = 1;
        while ((long) raw.width() / (sample * 2) >= rawOutW && (long) raw.height() / (sample * 2) >= rawOutH) sample *= 2;
        boolean whole = raw.left == 0 && raw.top == 0 && raw.width() == s.rawW && raw.height() == s.rawH;
        long sampledPixels = (long) (raw.width() / sample) * (raw.height() / sample);

        Bitmap target;
        BitmapRegionDecoder region = (!whole || sampledPixels > DECODE_BUDGET_PIXELS) ? regionDecoder(s) : null;
        if (region != null) {
            try {
                target = decodeStrips(region, raw, sample, rawOutW, rawOutH);
            } finally {
                region.recycle();
            }
        } else {
            if (!whole) {
                // No region decoder for this format: decode all (sampled) and cut the crop out.
                Log.w(TAG, "[image] no region decoder (" + s.mime + "), cropping a full decode");
            }
            while (sampledPixels > DECODE_BUDGET_PIXELS) {
                sample *= 2;
                sampledPixels = (long) (s.rawW / sample) * (s.rawH / sample);
            }
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inSampleSize = sample;
            o.inPreferredConfig = Bitmap.Config.ARGB_8888;
            Bitmap full = decodeFull(s, o);
            if (full == null) throw new IllegalStateException("그림을 풀지 못했어요");
            float k = (float) full.getWidth() / s.rawW;
            Rect src = new Rect(Math.round(raw.left * k), Math.round(raw.top * k), Math.round(raw.right * k),
                    Math.round(raw.bottom * k));
            target = Bitmap.createBitmap(rawOutW, rawOutH, Bitmap.Config.ARGB_8888);
            new Canvas(target).drawBitmap(full, src, new Rect(0, 0, rawOutW, rawOutH), new Paint(Paint.FILTER_BITMAP_FLAG));
            full.recycle();
        }
        if (s.rotation == 0 && !s.flip) return target;
        Matrix m = new Matrix();
        if (s.flip) m.postScale(-1, 1);
        m.postRotate(s.rotation);
        Bitmap upright = Bitmap.createBitmap(target, 0, 0, target.getWidth(), target.getHeight(), m, true);
        if (upright != target) target.recycle();
        return upright;
    }

    /** Decodes `raw` in horizontal bands (sampled) and scales each band into an outW x outH bitmap. */
    private static Bitmap decodeStrips(BitmapRegionDecoder region, Rect raw, int sample, int outW, int outH) {
        Bitmap target = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(target);
        Paint paint = new Paint(Paint.FILTER_BITMAP_FLAG);
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inSampleSize = sample;
        o.inPreferredConfig = Bitmap.Config.ARGB_8888;
        int bandRaw = (int) Math.max(sample * 16L, STRIP_PIXELS * sample * sample / Math.max(1, raw.width()));
        bandRaw = Math.max(sample, bandRaw / sample * sample); // whole sampled rows
        final int overlap = 2 * sample; // a little extra so bilinear scaling has neighbours at band edges
        double scaleY = (double) outH / raw.height();
        for (int y = raw.top; y < raw.bottom; y += bandRaw) {
            int y0 = Math.max(raw.top, y - overlap);
            int y1 = Math.min(raw.bottom, y + bandRaw + overlap);
            Bitmap band = region.decodeRegion(new Rect(raw.left, y0, raw.right, y1), o);
            if (band == null) throw new IllegalStateException("그림 일부를 풀지 못했어요");
            // Part of the band that belongs to [y, y+bandRaw), in band pixels.
            double perRaw = (double) band.getHeight() / (y1 - y0);
            int srcTop = (int) Math.round((y - y0) * perRaw);
            int srcBottom = (int) Math.round((Math.min(raw.bottom, y + bandRaw) - y0) * perRaw);
            int dstTop = (int) Math.round((y - raw.top) * scaleY);
            int dstBottom = (int) Math.round((Math.min(raw.bottom, y + bandRaw) - raw.top) * scaleY);
            if (dstBottom > dstTop && srcBottom > srcTop) {
                canvas.drawBitmap(band, new Rect(0, srcTop, band.getWidth(), srcBottom),
                        new Rect(0, dstTop, outW, dstBottom), paint);
            }
            band.recycle();
        }
        return target;
    }

    private static byte[] luma(Bitmap bmp) {
        Bitmap small = Bitmap.createScaledBitmap(bmp, LUMA_W, LUMA_H, true);
        int[] px = new int[LUMA_W * LUMA_H];
        small.getPixels(px, 0, LUMA_W, 0, 0, LUMA_W, LUMA_H);
        if (small != bmp) small.recycle();
        byte[] out = new byte[px.length];
        for (int i = 0; i < px.length; i++) {
            int c = px[i];
            int r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
            out[i] = (byte) ((r * 77 + g * 150 + b * 29) >> 8);
        }
        return out;
    }

    static boolean isImageName(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        for (String ext : Arrays.asList(".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".avif", ".gif", ".bmp")) {
            if (n.endsWith(ext)) return true;
        }
        return false;
    }

    /** Same order as image_logic.cpp NaturalLess: digit runs compare as numbers, case-insensitive. */
    static int naturalCompare(String a, String b) {
        int i = 0, j = 0;
        while (i < a.length() && j < b.length()) {
            char ca = a.charAt(i), cb = b.charAt(j);
            if (Character.isDigit(ca) && Character.isDigit(cb)) {
                int i2 = i, j2 = j;
                while (i2 < a.length() && a.charAt(i2) == '0') i2++;
                while (j2 < b.length() && b.charAt(j2) == '0') j2++;
                int ie = i2, je = j2;
                while (ie < a.length() && Character.isDigit(a.charAt(ie))) ie++;
                while (je < b.length() && Character.isDigit(b.charAt(je))) je++;
                if (ie - i2 != je - j2) return (ie - i2) - (je - j2);
                int c = a.substring(i2, ie).compareTo(b.substring(j2, je));
                if (c != 0) return c;
                i = ie;
                j = je;
                continue;
            }
            int la = Character.toLowerCase(ca), lb = Character.toLowerCase(cb);
            if (la != lb) return la - lb;
            i++;
            j++;
        }
        int ra = a.length() - i, rb = b.length() - j;
        if (ra != rb) return ra - rb;
        return a.compareTo(b);
    }
}
