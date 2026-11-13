package com.sharp.questnative.source;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** Download, reuse, LRU trim and cut-short handling of the photo/PLY cache, against a local HTTP server. */
public class PcCacheTest {
    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private MiniHttp server;
    private String base;
    private AtomicInteger hits;
    private final byte[] body = new byte[3 * 1024 * 1024 + 17];

    @Before
    public void start() throws IOException {
        for (int i = 0; i < body.length; i++) body[i] = (byte) (i * 31);
        server = new MiniHttp();
        server.routes.put("/files/r/a.png", new MiniHttp.Reply(200, body.length, body));
        server.routes.put("/files/r/short.ply", new MiniHttp.Reply(200, 1000, new byte[10]));
        server.routes.put("/files/r/missing.png", new MiniHttp.Reply(404, 0, new byte[0]));
        hits = server.hits;
        base = server.base();
    }

    @After
    public void stop() throws IOException {
        server.close();
    }

    @Test
    public void downloadsOnceThenReuses() throws IOException {
        PcCache cache = new PcCache(tmp.newFolder("c"), 64L << 20);
        AtomicInteger reports = new AtomicInteger();
        File f = cache.fetch(base + "/files/r/a.png", body.length, 5, "a.png", (d, t) -> reports.incrementAndGet());
        assertArrayEquals(body, Files.readAllBytes(f.toPath()));
        assertTrue(f.getName().endsWith(".png"));
        assertTrue(reports.get() >= 1);
        File again = cache.fetch(base + "/files/r/a.png", body.length, 5, "a.png", null);
        assertEquals(f, again);
        assertEquals(1, hits.get());
        // Changed on the PC (new mtime) -> new copy.
        File changed = cache.fetch(base + "/files/r/a.png", body.length, 6, "a.png", null);
        assertNotEquals(f, changed);
        assertEquals(2, hits.get());
        assertEquals(2L * body.length, cache.usedBytes());
    }

    @Test
    public void cutDownloadLeavesNothing() throws IOException {
        File dir = tmp.newFolder("c");
        PcCache cache = new PcCache(dir, 64L << 20);
        try {
            cache.fetch(base + "/files/r/short.ply", 1000, 1, "short.ply", null);
            fail();
        } catch (IOException expected) {
            // cut short
        }
        try {
            cache.fetch(base + "/files/r/missing.png", 10, 1, "missing.png", null);
            fail();
        } catch (PcApi.HttpError e) {
            assertEquals(404, e.code);
        }
        String[] left = dir.list();
        assertEquals(0, left == null ? 0 : left.length);
    }

    @Test
    public void trimsLeastRecentlyUsedButKeepsCurrent() throws IOException {
        File dir = tmp.newFolder("c");
        PcCache cache = new PcCache(dir, 2500);
        File a = write(dir, "a.bin", 1000, 1_000_000L);
        File b = write(dir, "b.bin", 1000, 2_000_000L);
        File c = write(dir, "c.bin", 1000, 3_000_000L);
        cache.trim(0, a);
        assertTrue(a.exists()); // kept although oldest
        assertFalse(b.exists());
        assertTrue(c.exists());
        cache.trim(1000, null);
        assertFalse(a.exists());
        assertTrue(c.exists());
        assertEquals(1000, cache.usedBytes());
    }

    @Test
    public void tooLargeForCacheFailsBeforeDownloading() throws IOException {
        PcCache cache = new PcCache(tmp.newFolder("c"), 1000);
        try {
            cache.fetch(base + "/files/r/a.png", body.length, 1, "a.png", null);
            fail();
        } catch (IOException expected) {
            assertEquals(0, hits.get());
        }
    }

    @Test
    public void findChecksSize() throws IOException {
        File dir = tmp.newFolder("c");
        PcCache cache = new PcCache(dir, 1 << 20);
        String url = base + "/files/r/x.png";
        File f = new File(dir, PcCache.key(url, 10, 1, "x.png"));
        Files.write(f.toPath(), new byte[5]);
        assertNull(cache.find(url, 10, 1, "x.png"));
        assertFalse(f.exists());
        Files.write(f.toPath(), new byte[10]);
        assertEquals(f, cache.find(url, 10, 1, "x.png"));
    }

    @Test
    public void defaultLimit() {
        assertEquals(4L << 30, PcCache.defaultLimit(100L << 30));
        assertEquals(2L << 30, PcCache.defaultLimit(8L << 30));
        assertEquals(256L << 20, PcCache.defaultLimit(100L << 20));
        assertTrue(PcCache.key("u", 1, 2, "A.PNG").endsWith(".png"));
    }

    private static File write(File dir, String name, int len, long mtime) throws IOException {
        File f = new File(dir, name);
        Files.write(f.toPath(), new byte[len]);
        assertTrue(f.setLastModified(mtime));
        return f;
    }
}
