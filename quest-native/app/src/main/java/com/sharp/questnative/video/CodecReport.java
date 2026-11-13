package com.sharp.questnative.video;

import android.content.Context;
import android.hardware.display.DisplayManager;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.os.Build;
import android.util.Range;
import android.view.Display;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeSet;

/**
 * Reads the device's decoders from MediaCodecList (names, hardware flag, profiles/levels, size,
 * frame-rate and bitrate ranges, performance points, 10-bit and HDR profiles) and asks each decoder
 * whether it supports every test video's size and rate. Owner: video-dev.
 */
final class CodecReport {
    private CodecReport() {}

    static final List<String> VIDEO_MIMES = Arrays.asList("video/avc", "video/hevc", "video/x-vnd.on2.vp9",
            "video/av01", "video/dolby-vision");
    static final List<String> AUDIO_MIMES = Arrays.asList("audio/mp4a-latm", "audio/opus", "audio/ac3", "audio/eac3",
            "audio/eac3-joc", "audio/ac4");

    private static String profilePrefix(String mime) {
        switch (mime) {
            case "video/avc": return "AVCProfile";
            case "video/hevc": return "HEVCProfile";
            case "video/x-vnd.on2.vp9": return "VP9Profile";
            case "video/av01": return "AV1Profile";
            case "video/dolby-vision": return "DolbyVisionProfile";
            default: return null;
        }
    }

    private static String[] levelPrefixes(String mime) {
        switch (mime) {
            case "video/avc": return new String[] {"AVCLevel"};
            case "video/hevc": return new String[] {"HEVCMainTierLevel", "HEVCHighTierLevel"};
            case "video/x-vnd.on2.vp9": return new String[] {"VP9Level"};
            case "video/av01": return new String[] {"AV1Level"};
            case "video/dolby-vision": return new String[] {"DolbyVisionLevel"};
            default: return new String[0];
        }
    }

    /** Name of a CodecProfileLevel constant by value, via reflection (e.g. 2 -> "HEVCProfileMain10"). */
    private static String constantName(int value, String... prefixes) {
        for (Field f : MediaCodecInfo.CodecProfileLevel.class.getFields()) {
            if (f.getType() != int.class || !Modifier.isStatic(f.getModifiers())) continue;
            for (String p : prefixes) {
                if (!f.getName().startsWith(p)) continue;
                try {
                    if (f.getInt(null) == value) return f.getName().substring(p.length());
                } catch (IllegalAccessException ignored) {
                    // skip
                }
            }
        }
        return "0x" + Integer.toHexString(value);
    }

    private static String range(Range<? extends Number> r) {
        if (r == null) return "";
        return r.getLower() + "-" + r.getUpper();
    }

    static List<DiagReport.CodecInfo> collect() {
        List<DiagReport.CodecInfo> out = new ArrayList<>();
        MediaCodecInfo[] infos = new MediaCodecList(MediaCodecList.ALL_CODECS).getCodecInfos();
        List<String> wanted = new ArrayList<>(VIDEO_MIMES);
        wanted.addAll(AUDIO_MIMES);
        for (String mime : wanted) {
            for (MediaCodecInfo info : infos) {
                if (info.isEncoder()) continue;
                boolean match = false;
                for (String t : info.getSupportedTypes()) match |= t.equalsIgnoreCase(mime);
                if (!match) continue;
                try {
                    out.add(describe(info, mime));
                } catch (RuntimeException e) {
                    DiagReport.CodecInfo c = new DiagReport.CodecInfo();
                    c.name = info.getName();
                    c.mime = mime;
                    c.audioInfo = "capabilities error: " + e;
                    out.add(c);
                }
            }
        }
        return out;
    }

    private static DiagReport.CodecInfo describe(MediaCodecInfo info, String mime) {
        DiagReport.CodecInfo c = new DiagReport.CodecInfo();
        c.name = info.getName();
        c.mime = mime;
        if (Build.VERSION.SDK_INT >= 29) {
            c.canonicalName = info.getCanonicalName();
            c.hardware = info.isHardwareAccelerated();
            c.softwareOnly = info.isSoftwareOnly();
            c.vendor = info.isVendor();
            if (info.isAlias()) c.aliases.add("(alias)");
        }
        MediaCodecInfo.CodecCapabilities caps = info.getCapabilitiesForType(mime);
        c.maxInstances = caps.getMaxSupportedInstances();

        String pp = profilePrefix(mime);
        TreeSet<String> hdr = new TreeSet<>();
        if (pp != null && caps.profileLevels != null) {
            for (MediaCodecInfo.CodecProfileLevel pl : caps.profileLevels) {
                String profile = constantName(pl.profile, pp);
                String level = constantName(pl.level, levelPrefixes(mime));
                c.profileLevels.add(profile + " / " + level);
                String up = profile.toUpperCase(Locale.ROOT);
                if (up.contains("10") || "VP9Profile2".equals(pp + profile) || up.equals("2") || up.equals("3")) {
                    c.tenBit = true;
                }
                if (up.contains("HDR10PLUS")) hdr.add("HDR10+");
                else if (up.contains("HDR")) hdr.add("HDR10");
            }
        }
        if (mime.equals("video/dolby-vision")) hdr.add("DolbyVision");
        if (caps.colorFormats != null) {
            for (int f : caps.colorFormats) {
                if (f == 54 /* COLOR_FormatYUVP010 */) c.tenBit = true;
            }
        }
        c.hdr.addAll(hdr);

        MediaCodecInfo.VideoCapabilities vc = caps.getVideoCapabilities();
        if (vc != null) {
            c.widths = range(vc.getSupportedWidths());
            c.heights = range(vc.getSupportedHeights());
            c.frameRates = range(vc.getSupportedFrameRates());
            c.bitrates = range(vc.getBitrateRange());
            c.widthAlignment = vc.getWidthAlignment();
            c.heightAlignment = vc.getHeightAlignment();
            if (Build.VERSION.SDK_INT >= 29 && vc.getSupportedPerformancePoints() != null) {
                for (MediaCodecInfo.VideoCapabilities.PerformancePoint p : vc.getSupportedPerformancePoints()) {
                    c.performancePoints.add(p.toString());
                }
            }
            for (DiagTests.Spec s : DiagTests.CATALOG) {
                if (!s.mime().equals(mime)) continue;
                Map<String, Object> check = new LinkedHashMap<>();
                check.put("sizeAndRate", vc.areSizeAndRateSupported(s.width, s.height, s.fps));
                String ach = null;
                try {
                    ach = range(vc.getAchievableFrameRatesFor(s.width, s.height));
                } catch (IllegalArgumentException e) {
                    ach = "size unsupported";
                }
                check.put("achievableFps", ach == null || ach.isEmpty() ? null : ach);
                c.testChecks.put(s.id, check);
            }
        }
        MediaCodecInfo.AudioCapabilities ac = caps.getAudioCapabilities();
        if (ac != null) {
            c.bitrates = range(ac.getBitrateRange());
            int[] rates = ac.getSupportedSampleRates();
            String sr = rates != null && rates.length > 0 ? rates[0] + "-" + rates[rates.length - 1] + " Hz"
                    : range(ac.getSupportedSampleRateRanges().length > 0 ? ac.getSupportedSampleRateRanges()[0] : null)
                            + " Hz";
            c.audioInfo = "max " + ac.getMaxInputChannelCount() + " ch, " + sr;
        }
        return c;
    }

    static Map<String, Object> device(Context context) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("manufacturer", Build.MANUFACTURER);
        d.put("model", Build.MODEL);
        d.put("device", Build.DEVICE);
        d.put("android", Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")");
        d.put("build", Build.DISPLAY);
        try {
            DisplayManager dm = context.getSystemService(DisplayManager.class);
            Display disp = dm == null ? null : dm.getDisplay(Display.DEFAULT_DISPLAY);
            if (disp != null) {
                TreeSet<String> rates = new TreeSet<>();
                for (Display.Mode mode : disp.getSupportedModes()) {
                    rates.add(String.format(Locale.ROOT, "%dx%d@%.0f", mode.getPhysicalWidth(),
                            mode.getPhysicalHeight(), mode.getRefreshRate()));
                }
                d.put("displayModes", String.join(", ", rates));
                Display.HdrCapabilities hc = disp.getHdrCapabilities();
                List<String> types = new ArrayList<>();
                if (hc != null) {
                    for (int t : hc.getSupportedHdrTypes()) {
                        types.add(t == 1 ? "DolbyVision" : t == 2 ? "HDR10" : t == 3 ? "HLG" : t == 4 ? "HDR10+"
                                : Integer.toString(t));
                    }
                }
                d.put("displayHdr", types.isEmpty() ? "없음" : String.join(", ", types));
            }
        } catch (RuntimeException e) {
            d.put("display", "error: " + e.getMessage());
        }
        return d;
    }
}
