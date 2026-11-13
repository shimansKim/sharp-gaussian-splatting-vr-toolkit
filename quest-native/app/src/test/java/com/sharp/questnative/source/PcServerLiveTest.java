package com.sharp.questnative.source;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import com.sharp.questnative.core.MediaEntry;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * Against a real scripts/quest_media_server.py. Skipped unless QN_PC_SERVER is set, e.g.
 * <pre>
 *   python scripts/quest_media_server.py --no-mdns --no-remember &lt;folder with media&gt;
 *   set QN_PC_SERVER=http://127.0.0.1:8787
 *   gradlew :app:testReleaseUnitTest --tests *PcServerLiveTest
 * </pre>
 */
public class PcServerLiveTest {
    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    @Test
    public void listsWholeTreeAndDownloadsAFile() throws IOException {
        String env = System.getenv("QN_PC_SERVER");
        assumeTrue("QN_PC_SERVER not set", env != null && !env.isEmpty());
        String base = PcApi.normalizeBase(env);
        assertNotNull(base);

        PcDiscovery.HTTP.probe(base);
        PcApi.Info info = PcApi.fetchInfo(base, 2000, 5000);
        assertTrue(info.version >= PcApi.MIN_VERSION);
        assertFalse(info.roots.isEmpty());

        List<MediaEntry> files = new ArrayList<>();
        int folders = 0;
        List<String[]> queue = new ArrayList<>();
        for (PcApi.Root r : info.roots) queue.add(new String[] {r.id, ""});
        while (!queue.isEmpty() && folders < 200) {
            String[] rp = queue.remove(0);
            folders++;
            for (MediaEntry e : PcApi.fetchFolder(base, rp[0], rp[1])) {
                if (e.folder) queue.add(PcApi.splitId(e.id));
                else files.add(e);
            }
        }
        System.out.println("[live] " + base + " v" + info.version + " roots=" + info.roots.size() + " folders="
                + folders + " files=" + files.size());
        assertFalse("no media files under the shared folders", files.isEmpty());

        MediaEntry small = null;
        for (MediaEntry e : files) if (e.size > 0 && (small == null || e.size < small.size)) small = e;
        assertNotNull(small);
        PcCache cache = new PcCache(tmp.newFolder("cache"), 1L << 30);
        File f = cache.fetch(small.uri, small.size, small.modifiedMs, small.name, null);
        assertEquals(small.size, Files.size(f.toPath()));
        System.out.println("[live] downloaded " + small.name + " (" + small.size + " bytes) from " + small.uri);

        try {
            PcApi.get(base + "/files/" + PcApi.enc(info.roots.get(0).id) + "/..%2F..%2Fsecret.mp4", 2000, 5000);
            throw new AssertionError("path outside root was served");
        } catch (PcApi.HttpError e) {
            assertTrue(e.code == 403 || e.code == 404);
        }
    }
}
