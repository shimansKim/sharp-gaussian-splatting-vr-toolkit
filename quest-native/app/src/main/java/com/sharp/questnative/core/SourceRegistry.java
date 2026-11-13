package com.sharp.questnative.core;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Registered media sources, in registration order. Thread-safe. Owner: foundation. */
public final class SourceRegistry {
    private static final List<MediaSource> sources = new ArrayList<>();

    private SourceRegistry() {}

    public static synchronized void register(MediaSource source) {
        sources.add(source);
    }

    public static synchronized List<MediaSource> all() {
        return Collections.unmodifiableList(new ArrayList<>(sources));
    }

    public static synchronized MediaSource find(String id) {
        for (MediaSource s : sources) {
            if (s.id().equals(id)) return s;
        }
        return null;
    }
}
