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
}
