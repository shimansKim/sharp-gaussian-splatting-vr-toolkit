package com.sharp.questnative.core;

import java.util.Locale;

/**
 * File kind by extension. Same lists as the native viewer registrations (splat, video, image):
 * keep them in sync when a viewer adds an extension. Owner: foundation.
 */
public final class MediaKind {
    public static final String SPLAT = "splat";
    public static final String VIDEO = "video";
    public static final String IMAGE = "image";

    private MediaKind() {}

    public static String extension(String name) {
        if (name == null) return "";
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot).toLowerCase(Locale.ROOT);
    }

    /** "splat", "video", "image", or null when no viewer opens it. */
    public static String of(String name, String mimeType) {
        switch (extension(name)) {
            case ".ply": case ".spz": case ".splat":
                return SPLAT;
            case ".mp4": case ".m4v": case ".mkv": case ".webm": case ".mov":
            case ".qndiag":  // video module: decoder diagnostics home (video/DiagRunner)
                return VIDEO;
            case ".jpg": case ".jpeg": case ".png": case ".webp": case ".heic": case ".heif": case ".avif":
            case ".gif": case ".bmp":
                return IMAGE;
            default:
                break;
        }
        if (mimeType != null) {
            if (mimeType.startsWith("video/")) return VIDEO;
            if (mimeType.startsWith("image/")) return IMAGE;
        }
        return null;
    }
}
