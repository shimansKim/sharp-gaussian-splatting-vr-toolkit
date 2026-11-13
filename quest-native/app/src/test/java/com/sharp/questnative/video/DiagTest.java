package com.sharp.questnative.video;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.Test;

/** Decoder diagnostics: test catalog, pass rule, result files. Run: gradlew :app:testReleaseUnitTest */
public class DiagTest {
    // ---------------------------------------------------------------- catalog

    @Test
    public void catalogMatchesEncodingGuideNames() {
        assertEquals(18, DiagTests.CATALOG.size());
        // encoding-guide.md 3.1 file names, unchanged
        String[] guide = {"T01_h264_1920x1080_30_10M.mp4", "T02_h264_3840x2160_60_40M.mp4",
                "T03_h264_4096x2048_60_50M.mp4", "T04_h264_5760x2880_30_60M.mp4", "T05_hevc_3840x2160_60_30M.mp4",
                "T06_hevc_5760x2880_60_50M.mp4", "T07_hevc_7680x3840_60_80M.mp4", "T08_hevc_8192x4096_60_100M.mp4",
                "T09_hevc_5760x5760_60_100M.mp4", "T10_hevc10_8192x4096_60_100M.mp4",
                "T11_hevc_8192x4096_60_150M.mp4", "T12_hevc_3840x2160_120_50M.mp4", "T13_av1_8192x4096_60_60M.mp4",
                "T14_av1-10_5760x2880_60_40M.mp4", "T15_hevc_3840x1920_30_30M_opus.mkv"};
        for (int i = 0; i < guide.length; i++) {
            assertEquals(guide[i], DiagTests.CATALOG.get(i).file);
            DiagTests.Spec parsed = DiagTests.forFile(guide[i]);
            assertNotNull(guide[i], parsed);
            assertEquals(String.format("T%02d", i + 1), parsed.id);
        }
        for (DiagTests.Spec s : DiagTests.CATALOG) {
            assertEquals(s, DiagTests.forFile(s.file));  // every bat output name maps back to its spec
            assertFalse(s.mime(), s.mime().isEmpty());
        }
    }

    @Test
    public void specValues() {
        DiagTests.Spec t10 = DiagTests.byId("T10");
        assertEquals("video/hevc", t10.mime());
        assertEquals(8192, t10.width);
        assertEquals(4096, t10.height);
        assertEquals(60f, t10.fps, 0);
        assertTrue(t10.tenBit);
        assertTrue(DiagTests.byId("T16").hdr);
        assertEquals("ac3", DiagTests.byId("T17").audio);
        assertEquals("video/av01", DiagTests.byId("t13").mime());
    }

    @Test
    public void unknownTestNamesAreParsedOrSkipped() {
        DiagTests.Spec x = DiagTests.forFile("T30_hevc10_4096x4096_50_70M_extra.mp4");
        assertEquals("T30", x.id);
        assertEquals("hevc", x.codec);
        assertTrue(x.tenBit);
        assertEquals(4096, x.width);
        assertEquals(50f, x.fps, 0);
        assertEquals(70, x.mbps);
        assertNull(DiagTests.forFile("holiday.mp4"));
        assertNull(DiagTests.forFile("T01_notes.txt"));
        List<String> picked = DiagTests.pickTestFiles(Arrays.asList("T05_hevc_3840x2160_60_30M.mp4", "readme.txt",
                "T01_h264_1920x1080_30_10M.mp4", "movie.mp4"));
        assertEquals(Arrays.asList("T01_h264_1920x1080_30_10M.mp4", "T05_hevc_3840x2160_60_30M.mp4"), picked);
    }

    // ---------------------------------------------------------------- pass rule

    private static DiagJudge.Measurement good() {
        DiagJudge.Measurement m = new DiagJudge.Measurement();
        m.decoderName = "c2.qti.hevc.decoder";
        m.hardware = true;
        m.fps = 60;
        m.playedSeconds = 20;
        m.renderedFrames = 1195;
        m.droppedFrames = 5;
        m.audioOutputBuffers = 900;
        return m;
    }

    @Test
    public void hardwareAndUnderOnePercentPasses() {
        DiagJudge.Result r = DiagJudge.judge(good(), 60);
        assertEquals(DiagJudge.Verdict.PASS, r.verdict);
        assertEquals(1200, r.expectedFrames, 1e-9);
        assertEquals(5.0 / 1200 * 100, r.droppedPercent, 1e-9);
        assertTrue(r.audioOk);
        assertEquals("됨", r.label());
    }

    @Test
    public void onePercentOrMoreFails() {
        DiagJudge.Measurement m = good();
        m.droppedFrames = 12;  // 12 / 1200 = 1.0%
        assertEquals(DiagJudge.Verdict.FAIL, DiagJudge.judge(m, 60).verdict);
        m.droppedFrames = 11;
        assertEquals(DiagJudge.Verdict.PASS, DiagJudge.judge(m, 60).verdict);
    }

    @Test
    public void softwareDecoderFailsEvenWithoutDrops() {
        DiagJudge.Measurement m = good();
        m.hardware = false;
        m.droppedFrames = 0;
        DiagJudge.Result r = DiagJudge.judge(m, 60);
        assertEquals(DiagJudge.Verdict.FAIL, r.verdict);
        assertTrue(r.reason.contains("소프트웨어"));
        // hardware unknown: fall back to the name
        m.hardware = null;
        m.decoderName = "c2.android.hevc.decoder";
        assertEquals(DiagJudge.Verdict.FAIL, DiagJudge.judge(m, 60).verdict);
        m.decoderName = "c2.qti.hevc.decoder";
        assertEquals(DiagJudge.Verdict.PASS, DiagJudge.judge(m, 60).verdict);
    }

    @Test
    public void errorsNoFramesStallsAndInvalidRuns() {
        DiagJudge.Measurement m = good();
        m.error = "ERROR_CODE_DECODER_INIT_FAILED: x";
        assertEquals(DiagJudge.Verdict.ERROR, DiagJudge.judge(m, 60).verdict);

        m = good();
        m.renderedFrames = 0;
        assertEquals(DiagJudge.Verdict.FAIL, DiagJudge.judge(m, 60).verdict);

        m = good();
        m.playedSeconds = 6;  // decoder too slow, playback crawled
        m.renderedFrames = 300;
        m.droppedFrames = 0;
        DiagJudge.Result r = DiagJudge.judge(m, 60);
        assertEquals(DiagJudge.Verdict.FAIL, r.verdict);
        assertTrue(r.reason.contains("6.0초"));

        m = good();
        m.invalidReason = "헤드셋 화면이 꺼짐(측정 중단)";
        m.error = "also an error";
        assertEquals(DiagJudge.Verdict.INVALID, DiagJudge.judge(m, 60).verdict);  // invalid wins
    }

    @Test
    public void expectedFramesUseTrackFpsThenSpecFpsThenCountedFrames() {
        DiagJudge.Measurement m = good();
        assertEquals(1200, DiagJudge.judge(m, 30).expectedFrames, 1e-9);  // track fps 60 wins
        m.fps = 0;
        assertEquals(600, DiagJudge.judge(m, 30).expectedFrames, 1e-9);   // spec fps 30 x 20 s
        assertEquals(1200, DiagJudge.judge(m, 0).expectedFrames, 1e-9);   // no fps: counted frames
    }

    // ---------------------------------------------------------------- result files

    private static List<DiagReport.Entry> entries() {
        DiagJudge.Measurement m = good();
        m.testId = "T08";
        m.file = DiagTests.byId("T08").file;
        DiagJudge.Measurement bad = good();
        bad.testId = "T04";
        bad.decoderName = "c2.android.avc.decoder";
        bad.hardware = false;
        bad.error = "ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES: \"5760x2880\"\n";
        List<DiagReport.Entry> out = new ArrayList<>();
        out.add(new DiagReport.Entry(DiagTests.byId("T08"), m, DiagJudge.judge(m, 60)));
        out.add(new DiagReport.Entry(DiagTests.byId("T04"), bad, DiagJudge.judge(bad, 30)));
        return out;
    }

    private static DiagReport.CodecInfo codec() {
        DiagReport.CodecInfo c = new DiagReport.CodecInfo();
        c.name = "c2.qti.hevc.decoder";
        c.mime = "video/hevc";
        c.hardware = true;
        c.widths = "96-8192";
        c.heights = "96-8192";
        c.profileLevels.add("Main10 / MainTierLevel61");
        c.tenBit = true;
        c.hdr.add("HDR10");
        c.performancePoints.add("PerformancePoint(8192x4320@60)");
        Map<String, Object> chk = new LinkedHashMap<>();
        chk.put("sizeAndRate", true);
        chk.put("achievableFps", "30-60");
        c.testChecks.put("T08", chk);
        return c;
    }

    @Test
    public void jsonHasSchemaAndEscapesText() {
        Map<String, Object> dev = new LinkedHashMap<>();
        dev.put("model", "Quest 3");
        String json = DiagReport.json(DiagReport.build("0.1.0", "2026-11-14T10:00:00+0900", dev,
                Arrays.asList(codec()), entries()));
        assertTrue(json.contains("\"schema\": \"qn-decoder-diag/1\""));
        assertTrue(json.contains("\"verdict\": \"PASS\""));
        assertTrue(json.contains("\"verdict\": \"ERROR\""));
        assertTrue(json.contains("\\\"5760x2880\\\"\\n"));  // quotes and newline escaped
        assertTrue(json.contains("\"hardware\": false"));
        assertTrue(json.contains("\"fps\": 60,"));          // whole floats print as integers
        assertTrue(json.contains("\"sizeAndRate\": true"));
        assertBalanced(json);
    }

    @Test
    public void jsonNumbersAndNulls() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("a", 0.41666666);
        m.put("b", Double.NaN);
        m.put("c", null);
        m.put("d", new ArrayList<>());
        String j = DiagReport.json(m);
        assertTrue(j, j.contains("\"a\": 0.4167"));
        assertTrue(j.contains("\"b\": null"));
        assertTrue(j.contains("\"c\": null"));
        assertTrue(j.contains("\"d\": []"));
    }

    @Test
    public void markdownSummary() {
        Map<String, Object> dev = new LinkedHashMap<>();
        dev.put("model", "Quest 3");
        String md = DiagReport.markdown("0.1.0", "2026-11-14", dev, Arrays.asList(codec()), entries());
        assertTrue(md.contains("## 시험 영상 재생 (1 / 2 됨)"));
        assertTrue(md.contains("| T08 | HEVC Main 8192x4096 60fps 100M | 됨 | c2.qti.hevc.decoder | 예 |"));
        assertTrue(md.contains("| T04 |"));
        assertTrue(md.contains("오류"));
        assertTrue(md.contains("| c2.qti.hevc.decoder | T08 | 예 | 30-60 |"));
        for (String line : md.split("\n")) {
            if (line.startsWith("| T04")) assertFalse("newline inside a table cell", line.endsWith("\\n |"));
        }
    }

    private static void assertBalanced(String json) {
        int depth = 0;
        boolean inStr = false;
        for (int i = 0; i < json.length(); i++) {
            char c = json.charAt(i);
            if (inStr) {
                if (c == '\\') i++;
                else if (c == '"') inStr = false;
            } else if (c == '"') {
                inStr = true;
            } else if (c == '{' || c == '[') {
                depth++;
            } else if (c == '}' || c == ']') {
                depth--;
                assertTrue(depth >= 0);
            }
        }
        assertEquals(0, depth);
        assertFalse(inStr);
    }
}
