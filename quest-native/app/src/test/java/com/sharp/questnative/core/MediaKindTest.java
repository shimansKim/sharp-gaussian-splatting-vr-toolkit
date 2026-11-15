package com.sharp.questnative.core;

import org.junit.Test;
import static org.junit.Assert.*;

public class MediaKindTest {
    @Test public void captureExtensionsOverrideProviderMime() {
        assertEquals(MediaKind.IMAGE, MediaKind.of("photo.INSP", "application/octet-stream"));
        assertEquals(MediaKind.VIDEO, MediaKind.of("clip.INSV", "image/jpeg"));
    }
}
