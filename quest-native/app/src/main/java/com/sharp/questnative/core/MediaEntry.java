package com.sharp.questnative.core;

/** One file or folder listed by a {@link MediaSource}. Owner: foundation. */
public final class MediaEntry {
    public final String id;        // unique within its source
    public final String name;      // display name with extension
    public final boolean folder;
    public final String mimeType;  // may be null
    public final long size;        // bytes, -1 unknown
    public final long modifiedMs;  // epoch ms, 0 unknown
    public final String uri;       // content://, file:// or http(s)://; null for folders

    public MediaEntry(String id, String name, boolean folder, String mimeType, long size, long modifiedMs,
                      String uri) {
        this.id = id;
        this.name = name;
        this.folder = folder;
        this.mimeType = mimeType;
        this.size = size;
        this.modifiedMs = modifiedMs;
        this.uri = uri;
    }
}
