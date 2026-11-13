package com.sharp.questnative.image;

import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import com.sharp.questnative.core.NativeBridge;
import com.sharp.questnative.core.QnActivity;
import com.sharp.questnative.core.QnModule;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * Java half of the image module. Owner: image-dev. Found by name by core ModuleLoader.
 *
 * <p>Temporary open path (until the file browser exists): pictures pushed to the app's own folder
 * open by themselves, no storage permission needed:
 * <pre>
 *   adb push photo.jpg /sdcard/Android/data/com.sharp.questnative/files/images/
 *   adb shell am start -n com.sharp.questnative/.core.QnActivity                     # first picture
 *   adb shell am start -n com.sharp.questnative/.core.QnActivity --es qn.image name.jpg  # this one
 * </pre>
 * The extra may also be an absolute path or file:// uri the app can read. Other pictures of the
 * same folder are reached with a sideways flick of the right stick.
 */
public final class Module implements QnModule {
    private static final String TAG = "QuestNative";
    static final String EXTRA = "qn.image";

    private volatile boolean stopped;

    @Override
    public void onCreate(QnActivity activity) {
        ImageBridge.init(activity);
        File dir = activity.getExternalFilesDir("images");
        if (dir != null && !dir.exists() && !dir.mkdirs()) Log.w(TAG, "[image] cannot create " + dir);
        Intent intent = activity.getIntent();
        String extra = intent != null ? intent.getStringExtra(EXTRA) : null;
        File pick = choose(dir, extra);
        if (pick == null) {
            Log.i(TAG, "[image] Java module started; no picture to auto-open in " + dir);
            return;
        }
        Log.i(TAG, "[image] auto-open " + pick);
        Thread t = new Thread(() -> openWhenReady(pick), "qn-image-autoopen");
        t.setDaemon(true);
        t.start();
    }

    @Override
    public void onDestroy() {
        stopped = true;
    }

    private static File choose(File dir, String extra) {
        if (extra != null && !extra.isEmpty()) {
            String path = ImageBridge.pathOf(extra);
            File f = path != null ? new File(path) : (dir != null ? new File(dir, extra) : null);
            if (f != null && !f.isAbsolute() && dir != null) f = new File(dir, extra);
            if (f != null && f.isFile()) return f;
            Log.w(TAG, "[image] " + EXTRA + " not found: " + extra);
            return null;
        }
        if (dir == null) return null;
        File[] files = dir.listFiles();
        if (files == null) return null;
        List<File> images = new ArrayList<>();
        for (File f : files) {
            if (f.isFile() && ImageBridge.isImageName(f.getName())) images.add(f);
        }
        if (images.isEmpty()) return null;
        images.sort((a, b) -> ImageBridge.naturalCompare(a.getName(), b.getName()));
        return images.get(0);
    }

    /** The native side starts a little after onCreate; retry until it accepts the request (60 s). */
    private void openWhenReady(File f) {
        String uri = Uri.fromFile(f).toString();
        for (int i = 0; i < 120 && !stopped; i++) {
            if (NativeBridge.nativeOpenMedia(uri, f.getName(), "", "device", "", -1, f.length())) return;
            try {
                Thread.sleep(500);
            } catch (InterruptedException e) {
                return;
            }
        }
        Log.w(TAG, "[image] native side did not start; auto-open dropped");
    }
}
