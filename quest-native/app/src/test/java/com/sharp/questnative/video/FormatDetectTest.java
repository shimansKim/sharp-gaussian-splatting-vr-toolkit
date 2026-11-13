package com.sharp.questnative.video;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import org.junit.Test;

/**
 * Same cases as quest-app/tests/format-detect.test.js, so the native app detects formats exactly
 * like the web app. Run: gradlew :app:testReleaseUnitTest
 */
public class FormatDetectTest {
    private static String detect(String name, int w, int h) {
        return FormatDetect.detect(name, w, h, null).layout;
    }

    private static String detect(String name, int w, int h, FormatDetect.Spatial s) {
        return FormatDetect.detect(name, w, h, s).layout;
    }

    @Test
    public void layoutOrderHoldsEveryLayoutOnce() {
        List<String> sorted = new ArrayList<>(FormatDetect.LAYOUT_ORDER);
        Collections.sort(sorted);
        assertEquals(9, sorted.size());
        assertEquals(9, new java.util.HashSet<>(sorted).size());
        assertTrue(FormatDetect.isLayout("sbs180"));
        assertFalse(FormatDetect.isLayout("nope"));
        assertFalse(FormatDetect.isLayout("toString"));
        assertEquals("mono180", FormatDetect.nextLayout("sbs180", 1));
        assertEquals("sbs180", FormatDetect.nextLayout("mono2d", 1));
        assertEquals("mono2d", FormatDetect.nextLayout("sbs180", -1));
    }

    @Test
    public void repoFullSbsOutputIsAScreen() {
        assertEquals("sbsScreenFull", detect("DJAWA_Maruemon_02_quest3_8k_3D_FSBS.mp4", 8192, 2730));
        assertEquals("sbsScreenFull", detect("movie.mp4", 8192, 2730));
    }

    @Test
    public void nameHints() {
        assertEquals("mono360", detect("beach_360.mp4", 4096, 2048));
        assertEquals("tb360", detect("beach_360_TB.mp4", 4096, 4096));
        assertEquals("tb360", detect("beach_360_OU.mp4", 4096, 4096));
        assertEquals("sbs360", detect("beach_360_SBS.mp4", 8192, 2048));
        assertEquals("sbs180", detect("a_VR180_SBS.mp4", 4096, 2048));
        assertEquals("sbs180", detect("a_VR180.mp4", 4096, 2048));
        assertEquals("sbs180", detect("a_180_LR.mp4", 4096, 2048));
        assertEquals("mono180", detect("a_180_mono.mp4", 2048, 2048));
        assertEquals("sbsScreenHalf", detect("show_HSBS.mp4", 1920, 1080));
        assertEquals("sbsScreenFull", detect("show_FSBS.mp4", 3840, 1080));
        assertEquals("sbsScreenHalf", detect("show_SBS.mp4", 1920, 1080));
        assertEquals("tbScreen", detect("show_TB.mp4", 1920, 2160));
    }

    @Test
    public void ratioOnlyGuessesAreLowConfidence() {
        FormatDetect.Result r = FormatDetect.detect("clip.mp4", 4096, 2048, null);
        assertEquals("mono360", r.layout);
        assertEquals("low", r.confidence);
        assertEquals("tb360", detect("clip.mp4", 2048, 2048));
        assertEquals("sbs360", detect("clip.mp4", 8192, 2048));
        assertEquals("mono2d", detect("clip.mp4", 1920, 1080));
        assertEquals("mono2d", detect("clip.mp4", 1080, 1920));
        assertEquals("mono2d", detect("clip.mp4", 0, 0));
    }

    @Test
    public void sbsNamePlusTwoToOneIsVr180() {
        assertEquals("sbs180", detect("trip_3D_SBS.mp4", 4096, 2048));
    }

    @Test
    public void spatialMetadataBeatsName() {
        FormatDetect.Spatial vr180 = new FormatDetect.Spatial("left-right", "equirect", new double[] {0, 0, 0.25, 0.25});
        assertEquals("sbs180", detect("whatever.mp4", 4096, 2048, vr180));
        FormatDetect.Spatial tb360 = new FormatDetect.Spatial("top-bottom", "equirect", new double[] {0, 0, 0, 0});
        assertEquals("tb360", detect("whatever_SBS.mp4", 4096, 4096, tb360));
        FormatDetect.Spatial mono360 = new FormatDetect.Spatial("mono", "equirect", new double[] {0, 0, 0, 0});
        assertEquals("mono360", detect("whatever.mp4", 4096, 2048, mono360));
        assertEquals("high", FormatDetect.detect("x.mp4", 4096, 2048, vr180).confidence);
    }

    @Test
    public void unknownMetadataFallsBackToNameAndRatio() {
        assertEquals("sbs180", detect("a_VR180_SBS.mp4", 4096, 2048, new FormatDetect.Spatial(null, null, null)));
    }

    @Test
    public void nameHintsIgnoreExtensionAndFolders() {
        assertEquals("180", FormatDetect.parseNameHints("x_VR180_SBS.mp4").projection);
        assertNull(FormatDetect.parseNameHints("180p_video.mp4").projection);  // 180p is a resolution
        assertNull(FormatDetect.parseNameHints("C:\\clips\\sbs\\plain.mp4").stereo);
        assertNull(FormatDetect.parseNameHints("/sdcard/Movies/sbs/plain.mp4").stereo);
        assertNull(FormatDetect.parseNameHints("video.mp4").stereo);
    }

    @Test
    public void eyeAspect() {
        assertEquals(16.0 / 9, FormatDetect.eyeAspect("sbsScreenFull", 3840, 1080), 1e-9);
        assertEquals(8192.0 / 2 / 2730, FormatDetect.eyeAspect("sbsScreenFull", 8192, 2730), 1e-9);
        assertEquals(16.0 / 9, FormatDetect.eyeAspect("sbsScreenHalf", 1920, 1080), 1e-9);
        assertEquals(16.0 / 9, FormatDetect.eyeAspect("mono2d", 1280, 720), 1e-9);
        assertEquals(1920.0 / 1080, FormatDetect.eyeAspect("tbScreen", 1920, 2160), 1e-9);
        assertEquals(16.0 / 9, FormatDetect.eyeAspect("tbScreen", 1920, 1080), 1e-9);
    }

    // ---- frame sniffing (quest-app sniffStereo)

    private static int[] noise(int w, int h, long seed) {
        java.util.Random r = new java.util.Random(seed);
        int[] px = new int[w * h];
        for (int i = 0; i < px.length; i++) px[i] = r.nextInt(256);
        return px;
    }

    @Test
    public void sniffFindsSideBySidePairs() {
        int w = 128, h = 64;
        int[] half = noise(w / 2, h, 1);
        int[] px = new int[w * h];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w / 2; x++) {
                px[y * w + x] = half[y * (w / 2) + x];
                int sx = Math.min(w / 2 - 1, x + 2);  // small disparity
                px[y * w + w / 2 + x] = half[y * (w / 2) + sx];
            }
        }
        assertEquals("sbs", FormatDetect.sniffStereo(px, w, h));
    }

    @Test
    public void sniffFindsTopBottomPairs() {
        int w = 128, h = 128;
        int[] half = noise(w, h / 2, 2);
        int[] px = new int[w * h];
        System.arraycopy(half, 0, px, 0, half.length);
        System.arraycopy(half, 0, px, half.length, half.length);
        assertEquals("tb", FormatDetect.sniffStereo(px, w, h));
    }

    @Test
    public void sniffSaysMonoForUnrelatedHalvesAndNullForFlat() {
        assertEquals("mono", FormatDetect.sniffStereo(noise(128, 64, 3), 128, 64));
        assertNull(FormatDetect.sniffStereo(new int[128 * 64], 128, 64));
    }

    @Test
    public void refineTurnsTwoToOneMonoIntoVr180WhenHalvesMatch() {
        FormatDetect.Result low = FormatDetect.detect("clip.mp4", 4096, 2048, null);
        FormatDetect.Result r = FormatDetect.refineWithSniff(low, "sbs", 2.0);
        assertEquals("sbs180", r.layout);
        assertEquals("medium", r.confidence);
        FormatDetect.Result named = FormatDetect.detect("clip_360.mp4", 4096, 2048, null);
        assertEquals(named, FormatDetect.refineWithSniff(named, "sbs", 2.0));  // only low guesses change
        FormatDetect.Result tb = FormatDetect.detect("clip.mp4", 2048, 2048, null);
        assertEquals("mono360", FormatDetect.refineWithSniff(tb, "mono", 1.0).layout);
    }
}
