package com.sharp.questnative.video;

import android.util.Log;

import com.sharp.questnative.core.QnActivity;
import com.sharp.questnative.core.QnModule;
import com.sharp.questnative.ui.hud.Hud;

import java.io.File;
import java.util.Arrays;
import java.util.Locale;

/**
 * Java half of the video module. Starts the player thread and registers the HUD provider.
 * Found by name by core ModuleLoader. Owner: video-dev.
 */
public final class Module implements QnModule {
    private static final String[] VIDEO_EXT = {".mp4", ".m4v", ".mkv", ".webm", ".mov"};
    // null until onCreate ran (native may start first); "" = nothing to auto-open.
    private static volatile String autoplayPath = null;

    @Override
    public void onCreate(QnActivity activity) {
        VideoPlayer.init(activity);
        Hud.register("video", new VideoHud());
        // Temporary open path until the file browser exists (no storage permission needed):
        //   adb push clip.mp4 /sdcard/Android/data/com.sharp.questnative/files/Movies/
        File dir = activity.getExternalFilesDir("Movies");
        autoplayPath = findFirstVideo(dir);
        Log.i("QuestNative", "[video] Java module started; autoplay folder " + dir + " -> "
                + (autoplayPath.isEmpty() ? "(empty)" : autoplayPath));
    }

    @Override
    public void onDestroy() {
        Hud.unregister("video");
        VideoPlayer.shutdown();
    }

    /** Called by native (render thread). null: Java side not started yet; empty: nothing to open. */
    public static String autoplayPath() {
        return autoplayPath;
    }

    static String findFirstVideo(File dir) {
        File[] files = dir == null ? null : dir.listFiles();
        if (files == null) return "";
        Arrays.sort(files);
        for (File f : files) {
            String n = f.getName().toLowerCase(Locale.ROOT);
            for (String ext : VIDEO_EXT) {
                if (f.isFile() && n.endsWith(ext)) return f.getAbsolutePath();
            }
        }
        return "";
    }
}
