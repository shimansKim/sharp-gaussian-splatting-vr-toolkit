package com.sharp.questnative.core;

import java.io.IOException;
import java.util.List;

/**
 * A place files come from: device storage, the PC server, Google Drive. Register in your module's
 * onCreate with {@link SourceRegistry#register}. list/openFd do I/O: call them on a worker thread,
 * never on the main or render thread. Owner: foundation.
 */
public interface MediaSource {
    String id();           // "device", "pc", "gdrive"
    String displayName();  // shown in the folder tree

    /** Children of a folder; folderId null = root. */
    List<MediaEntry> list(String folderId) throws IOException;

    /** Detached file descriptor for a file entry, or -1 when the viewer should use entry.uri. */
    default int openFd(MediaEntry entry) throws IOException {
        return -1;
    }

    /**
     * One line for the source card the list panel shows when this source's root is empty or not
     * connected (e.g. "PC에 연결되지 않았어요"). null = the default text. Called on the ui draw thread:
     * return a cached value, do no I/O.
     */
    default String status() {
        return null;
    }

    /** True when {@link #openSetup} opens a setup screen; the card then shows [연결 설정]. */
    default boolean hasSetup() {
        return false;
    }

    /**
     * Opens the source's setup (e.g. a 2D settings Activity through QnActivity.startForResult).
     * Call done when it closed (any thread); the ui then re-reads the roots.
     */
    default void openSetup(Runnable done) {
        if (done != null) done.run();
    }
}
