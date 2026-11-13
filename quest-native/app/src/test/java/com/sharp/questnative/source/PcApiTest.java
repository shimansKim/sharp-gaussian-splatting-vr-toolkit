package com.sharp.questnative.source;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.sharp.questnative.core.MediaEntry;

import java.io.IOException;
import java.util.List;

import org.junit.Test;

/** Address rules, URL building and /api/info, /api/list parsing (shapes from scripts/quest_media_server.py). */
public class PcApiTest {
    @Test
    public void normalizeAcceptsHomeNetworkAddresses() {
        assertEquals("http://192.168.0.23:8787", PcApi.normalizeBase("192.168.0.23"));
        assertEquals("http://192.168.0.23:9000", PcApi.normalizeBase(" http://192.168.0.23:9000/ "));
        assertEquals("http://10.0.0.5:8787", PcApi.normalizeBase("10.0.0.5"));
        assertEquals("http://172.20.1.2:8787", PcApi.normalizeBase("172.20.1.2"));
        assertEquals("http://127.0.0.1:8787", PcApi.normalizeBase("127.0.0.1"));
        assertEquals("http://sharp-vr.local:8787", PcApi.normalizeBase("SHARP-VR.local"));
        assertEquals("http://desktop-abc:8787", PcApi.normalizeBase("DESKTOP-ABC"));
    }

    @Test
    public void normalizeRejectsInternetAndOddInput() {
        assertNull(PcApi.normalizeBase(""));
        assertNull(PcApi.normalizeBase(null));
        assertNull(PcApi.normalizeBase("8.8.8.8"));
        assertNull(PcApi.normalizeBase("172.32.0.1"));
        assertNull(PcApi.normalizeBase("192.169.0.1"));
        assertNull(PcApi.normalizeBase("192.168.0.300"));
        assertNull(PcApi.normalizeBase("192.168.0"));
        assertNull(PcApi.normalizeBase("example.com"));
        assertNull(PcApi.normalizeBase("https://192.168.0.2"));
        assertNull(PcApi.normalizeBase("192.168.0.2:99999"));
        assertNull(PcApi.normalizeBase("192.168.0.2:80x"));
        assertNull(PcApi.normalizeBase("192.168.0.2/files"));
        assertNull(PcApi.normalizeBase("user@192.168.0.2"));
        assertNull(PcApi.normalizeBase("192.168.0.2:8787@evil.com"));
    }

    @Test
    public void subnetSweepSkipsOwnAddressAndStartsLow() {
        List<String> bases = PcApi.subnetBases("192.168.0.57", 8787);
        assertEquals(253, bases.size());
        assertEquals("http://192.168.0.1:8787", bases.get(0));
        assertEquals("http://192.168.0.2:8787", bases.get(1));
        assertFalse(bases.contains("http://192.168.0.57:8787"));
        assertEquals("http://192.168.0.254:8787", bases.get(252));
        assertTrue(PcApi.subnetBases("8.8.8.8", 8787).isEmpty());
        assertTrue(PcApi.subnetBases("127.0.0.1", 8787).isEmpty());
        assertEquals("192.168.0", PcApi.ipv4Prefix("http://192.168.0.23:8787"));
        assertNull(PcApi.ipv4Prefix("http://sharp-vr.local:8787"));
    }

    @Test
    public void urlsAreEncodedPerSegment() {
        String b = "http://192.168.0.2:8787";
        assertEquals(b + "/files/outputs/a%20b/%ED%95%9C%EA%B8%80%2B1%23.mp4",
                PcApi.fileUrl(b, "outputs", "a b/한글+1#.mp4"));
        assertEquals(b + "/api/list?root=my%20root&path=a%2Fb%20c&offset=5000&limit=5000",
                PcApi.listUrl(b, "my root", "a/b c", 5000, 5000));
    }

    @Test
    public void parsesInfo() throws IOException {
        PcApi.Info i = PcApi.parseInfo("{\"app\":\"sharp-quest-server\",\"version\":3,\"host\":\"DESKTOP\","
                + "\"roots\":[{\"id\":\"outputs\",\"label\":\"outputs\"},{\"id\":\"vr\",\"label\":\"\"},"
                + "{\"id\":\"bad|id\",\"label\":\"x\"}]}");
        assertEquals(3, i.version);
        assertEquals("DESKTOP", i.host);
        assertEquals(2, i.roots.size());
        assertEquals("vr", i.roots.get(1).label);
        try {
            PcApi.parseInfo("{\"app\":\"other\"}");
            fail();
        } catch (IOException expected) {
            // not our server
        }
        try {
            PcApi.parseInfo("<html>");
            fail();
        } catch (IOException expected) {
            // not JSON
        }
    }

    @Test
    public void parsesListPage() throws IOException {
        String json = "{\"root\":\"outputs\",\"path\":\"vr\",\"total\":6000,\"offset\":0,\"nextOffset\":5000,\"items\":["
                + "{\"root\":\"outputs\",\"name\":\"sub\",\"path\":\"vr/sub\",\"type\":\"dir\",\"kind\":null,\"size\":null,\"mtime\":1700000000000},"
                + "{\"root\":\"outputs\",\"name\":\"a.mp4\",\"path\":\"vr/a.mp4\",\"type\":\"file\",\"kind\":\"video\",\"size\":123,\"mtime\":1700000000001},"
                + "{\"root\":\"outputs\",\"name\":\"s.ply\",\"path\":\"vr/s.ply\",\"type\":\"file\",\"kind\":\"splat\",\"size\":9,\"mtime\":2},"
                + "{\"root\":\"outputs\",\"name\":\"notes.txt\",\"path\":\"vr/notes.txt\",\"type\":\"file\",\"kind\":null,\"size\":1,\"mtime\":3},"
                + "{\"root\":\"outputs\",\"name\":\".hidden.mp4\",\"path\":\"vr/.hidden.mp4\",\"type\":\"file\",\"kind\":\"video\",\"size\":1,\"mtime\":3}"
                + "]}";
        PcApi.Page p = PcApi.parseList("http://192.168.0.2:8787", json);
        assertEquals(5000, p.nextOffset);
        assertEquals(6000, p.total);
        assertEquals(3, p.items.size());
        MediaEntry dir = p.items.get(0);
        assertTrue(dir.folder);
        assertEquals("outputs|vr/sub", dir.id);
        assertNull(dir.uri);
        MediaEntry video = p.items.get(1);
        assertFalse(video.folder);
        assertEquals(123, video.size);
        assertEquals(1700000000001L, video.modifiedMs);
        assertEquals("http://192.168.0.2:8787/files/outputs/vr/a.mp4", video.uri);
        assertEquals("s.ply", p.items.get(2).name);

        PcApi.Page last = PcApi.parseList("http://h:1", "{\"root\":\"r\",\"items\":[],\"nextOffset\":null}");
        assertEquals(-1, last.nextOffset);
    }

    @Test
    public void splitsIds() throws IOException {
        String[] rp = PcApi.splitId(PcApi.folderId("outputs", "a|b/c"));
        assertEquals("outputs", rp[0]);
        assertEquals("a|b/c", rp[1]);
        assertEquals("", PcApi.splitId("outputs|")[1]);
        try {
            PcApi.splitId("|x");
            fail();
        } catch (IOException expected) {
            // no root
        }
    }

    @Test
    public void baseOfFileUrl() {
        assertEquals("http://192.168.0.2:8787", PcSource.baseOf("http://192.168.0.2:8787/files/r/a.png"));
        assertNull(PcSource.baseOf("https://x/files"));
    }
}
