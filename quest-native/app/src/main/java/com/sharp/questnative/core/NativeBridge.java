package com.sharp.questnative.core;

/**
 * Java -> native calls owned by core (implemented in cpp/core/jni_bridge.cpp). Safe from any thread;
 * the native side queues the work for the render thread. Modules add their own native methods in
 * their own classes (JNI name Java_com_sharp_questnative_<id>_...) implemented in their own .cpp.
 * Owner: foundation.
 */
public final class NativeBridge {
    private NativeBridge() {}

    /**
     * Opens a file in the viewer chosen by extension (then MIME prefix).
     *
     * @param fd an open file descriptor the viewer takes ownership of, or -1 to use uri
     * @return false when the native side has not started yet (request dropped)
     */
    public static native boolean nativeOpenMedia(String uri, String name, String mimeType, String sourceId,
                                                 String layoutHint, int fd, long size);

    public static native void nativeCloseMedia();

    public static boolean openMedia(MediaEntry entry, String sourceId, int fd) {
        return nativeOpenMedia(entry.uri, entry.name, entry.mimeType == null ? "" : entry.mimeType, sourceId, "",
                fd, entry.size);
    }
}
