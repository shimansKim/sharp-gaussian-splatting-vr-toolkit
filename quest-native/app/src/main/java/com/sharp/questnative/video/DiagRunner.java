package com.sharp.questnative.video;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import com.sharp.questnative.core.NativeBridge;
import com.sharp.questnative.ui.UiPages;
import com.sharp.questnative.ui.hud.Hud;
import com.sharp.questnative.ui.hud.HudControl;
import com.sharp.questnative.ui.hud.HudModel;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Decoder diagnostics: lists the device decoders (CodecReport) and plays the test videos
 * (DiagTests) one by one through the normal video path, recording decoder name, hardware flag,
 * shown/dropped frames and the verdict (DiagJudge). Results go to
 * /sdcard/Android/data/com.sharp.questnative/files/diagnostics/ as JSON + Markdown.
 *
 * Entry for people: the list panel page [설정] > [진단] > 디코더 진단 (DiagPage, contract 16).
 * Entry for tools/diag_run.bat: the video viewer opens "*.qndiag" from the qn.open intent
 *   adb shell am start -n com.sharp.questnative/.core.QnActivity --es qn.open qn-diag://run-all/decoder-diagnostics.qndiag
 * and calls onHomeOpened(uri), which starts a run. Options ride in the URI (DiagTests.parseOptions):
 *   qn-diag://run-all/tests=T07,T08/seconds=180/decoder-diagnostics.qndiag
 * runs only T07 and T08 and stops each after 180 s; without seconds each file plays to its end
 * (so 2-3 minute videos from diag_make_videos.bat are measured whole). While a run plays the test videos the
 * video HUD (VideoHud) shows this class's model. Test videos are opened with
 * NativeBridge.nativeOpenMedia(sourceId "diag"); at the end the diagnostics page opens.
 * Owner: video-dev.
 */
public final class DiagRunner {
    private static final String TAG = "QuestNative";
    public static final String HOME_NAME = "decoder-diagnostics.qndiag";
    public static final String HOME_URI = "qn-diag://home/" + HOME_NAME;
    static final String DONE_FILE = "last-run.txt";

    private static Context appContext;
    private static File baseDir;  // .../files/diagnostics
    private static final Object lock = new Object();

    // guarded by lock
    private static boolean homeShown, running, cancel;
    private static List<String> testFiles = new ArrayList<>();
    private static int pick;
    private static String status = "";
    private static String current = "";
    private static final Map<String, DiagReport.Entry> results = new LinkedHashMap<>();
    private static List<DiagReport.CodecInfo> codecs;
    private static String lastSaved = "";
    private static String runStamp = "";

    private DiagRunner() {}

    static void init(Context context) {
        appContext = context.getApplicationContext();
        baseDir = context.getExternalFilesDir("diagnostics");
        if (baseDir != null) {
            //noinspection ResultOfMethodCallIgnored
            testsDir().mkdirs();
        }
    }

    static void shutdown() {
        synchronized (lock) {
            cancel = true;
        }
    }

    static File baseDir() {
        return baseDir;
    }

    static File testsDir() {
        return new File(baseDir, "tests");
    }

    // ------------------------------------------------------------------ native hooks (render thread)

    /** The viewer opened a ".qndiag" entry. uri host: home | run-all | codecs. */
    public static void onHomeOpened(String uri) {
        boolean runAll = uri != null && uri.startsWith("qn-diag://run-all");
        boolean codecsOnly = uri != null && uri.startsWith("qn-diag://codecs");
        synchronized (lock) {
            homeShown = true;
            refreshFilesLocked();
            if (status.isEmpty()) status = testFiles.size() + "개 시험 영상을 찾았습니다";
        }
        Hud.setVisible(true);
        invalidate();
        if (runAll) startSelected(DiagTests.parseOptions(uri));
        else if (codecsOnly) startCodecsOnly();
    }

    public static void onHomeClosed() {
        synchronized (lock) {
            homeShown = false;
        }
        invalidate();
    }

    static boolean hudActive() {
        synchronized (lock) {
            return homeShown || running;
        }
    }

    private static void refreshFilesLocked() {
        String[] names = baseDir == null ? null : testsDir().list();
        testFiles = DiagTests.pickTestFiles(names == null ? new ArrayList<>() : Arrays.asList(names));
        if (pick >= testFiles.size()) pick = 0;
    }

    // ------------------------------------------------------------------ HUD

    static HudModel describe() {
        HudModel m = new HudModel();
        synchronized (lock) {
            m.title = "디코더 진단";
            m.subtitle = android.os.Build.MODEL + " · 시험 영상 " + testFiles.size() + "개 · 결과 " + results.size() + "개";
            m.status = running ? "실행 중: " + current + " — " + status : status;
            HudControl all = HudControl.button("diag.runAll", "전체 실행", "play", 0);
            all.enabled = !running && !testFiles.isEmpty();
            m.add(all);
            HudControl stop = HudControl.button("diag.stop", "멈춤", "pause", 0);
            stop.enabled = running;
            m.add(stop);
            HudControl codecsBtn = HudControl.button("diag.codecs", "코덱 목록 저장", "diag", 0);
            codecsBtn.enabled = !running;
            m.add(codecsBtn);
            List<String> opts = new ArrayList<>();
            for (String f : testFiles) {
                DiagTests.Spec s = DiagTests.forFile(f);
                opts.add(s == null ? f : s.id + " " + s.profile + " " + s.width + "x" + s.height + " "
                        + DiagReport.fmtFps(s.fps) + "fps");
            }
            if (opts.isEmpty()) opts.add("시험 영상 없음");
            m.add(HudControl.choice("diag.pick", "시험", opts, Math.min(pick, opts.size() - 1), 1));
            HudControl one = HudControl.button("diag.runOne", "이 시험 실행", "play", 1);
            one.enabled = !running && !testFiles.isEmpty();
            m.add(one);
            if (!lastSaved.isEmpty()) {
                HudControl where = new HudControl();
                where.id = "diag.where";
                where.kind = HudControl.LABEL;
                where.label = "저장: " + lastSaved;
                where.row = 2;
                m.add(where);
            }
            for (DiagReport.Entry e : results.values()) {
                m.diagnostics.add(String.format(Locale.ROOT, "%s %s · %s · 버림 %s%% · 첫 화면 %s · %s", e.spec.id,
                        e.r.label(), e.m.decoderName.isEmpty() ? "-" : e.m.decoderName, DiagJudge.pctCell(e.r),
                        e.m.firstFrameMs >= 0 ? e.m.firstFrameMs + "ms" : "-", e.r.reason));
            }
            if (codecs != null) {
                for (DiagReport.CodecInfo c : codecs) {
                    if (!c.mime.startsWith("video/")) continue;
                    m.diagnostics.add(c.mime + " · " + c.name + (Boolean.TRUE.equals(c.hardware) ? " (HW)" : "")
                            + " · " + c.widths + " x " + c.heights + " · " + String.join(", ", c.performancePoints));
                }
            }
            if (m.diagnostics.isEmpty()) m.diagnostics.add("아직 결과가 없습니다. [전체 실행]을 누르세요.");
        }
        return m;
    }

    static void onAction(String id, float value, int phase) {
        if (phase != Hud.PHASE_COMMIT) return;
        switch (id) {
            case "diag.runAll":
                startRun(null);
                break;
            case "diag.runOne": {
                String f;
                synchronized (lock) {
                    f = testFiles.isEmpty() ? null : testFiles.get(Math.min(pick, testFiles.size() - 1));
                }
                if (f != null) startRun(f);
                break;
            }
            case "diag.stop":
                synchronized (lock) {
                    cancel = true;
                }
                break;
            case "diag.pick":
                synchronized (lock) {
                    pick = Math.max(0, (int) value);
                }
                break;
            case "diag.codecs":
                startCodecsOnly();
                break;
            default:
                break;
        }
        invalidate();
    }

    // ------------------------------------------------------------------ runs

    private static void setStatus(String s) {
        synchronized (lock) {
            status = s;
        }
        Log.i(TAG, "[video] diag: " + s);
        invalidate();
    }

    /** The model is shown on the diagnostics page and, during a run, on the video HUD. */
    private static void invalidate() {
        UiPages.invalidate();
        Hud.invalidate();
    }

    private static List<DiagReport.CodecInfo> codecs() {
        synchronized (lock) {
            if (codecs != null) return codecs;
        }
        List<DiagReport.CodecInfo> c;
        try {
            c = CodecReport.collect();
        } catch (RuntimeException e) {
            Log.e(TAG, "[video] diag: codec list failed", e);
            c = new ArrayList<>();
        }
        synchronized (lock) {
            codecs = c;
        }
        return c;
    }

    private static void startCodecsOnly() {
        synchronized (lock) {
            if (running) return;
            running = true;
            cancel = false;
            current = "코덱 목록";
            runStamp = stamp();
        }
        new Thread(() -> {
            try {
                codecs();
                String path = save(false);
                setStatus("코덱 목록을 저장했습니다: " + path);
            } finally {
                synchronized (lock) {
                    running = false;
                }
                invalidate();
            }
        }, "qn-diag").start();
    }

    /** onlyFile null = every test file in the folder. */
    static void startRun(String onlyFile) {
        if (onlyFile == null) {
            startSelected(new DiagTests.Options());
            return;
        }
        start(new ArrayList<>(Arrays.asList(onlyFile)), false, 0);
    }

    /** The tests the options pick (all when none), each measured to the end or opt.seconds. */
    static void startSelected(DiagTests.Options opt) {
        List<String> files = new ArrayList<>();
        synchronized (lock) {
            refreshFilesLocked();
            for (String f : testFiles) if (opt.selects(f)) files.add(f);
            if (files.isEmpty() && !opt.tests.isEmpty() && !running) {
                status = "고른 시험 영상(" + String.join(",", opt.tests) + ")이 없습니다. diag_push_videos.bat으로 넣으세요.";
                return;
            }
        }
        start(files, true, opt.seconds);
    }

    private static void start(List<String> files, boolean full, int capSeconds) {
        synchronized (lock) {
            if (running) return;
            if (files.isEmpty()) {
                status = "시험 영상이 없습니다. tools\\diag_push_videos.bat으로 넣으세요.";
                return;
            }
            running = true;
            cancel = false;
            runStamp = stamp();
            if (full) results.clear();
        }
        new Thread(() -> runAll(files, full, capSeconds), "qn-diag").start();
    }

    private static void runAll(List<String> files, boolean full, int capSeconds) {
        int pass = 0, done = 0;
        try {
            if (full) new File(baseDir, DONE_FILE).delete();
            setStatus("디코더 목록을 읽는 중");
            List<DiagReport.CodecInfo> cl = codecs();
            for (int i = 0; i < files.size(); i++) {
                synchronized (lock) {
                    if (cancel) break;
                    current = (i + 1) + "/" + files.size() + " " + files.get(i);
                }
                DiagReport.Entry e = measureWithRetry(files.get(i), cl, capSeconds);
                if (e == null) break;
                synchronized (lock) {
                    results.put(e.spec.id, e);
                }
                done++;
                if (e.r.verdict == DiagJudge.Verdict.PASS) pass++;
                save(false);
            }
            boolean cancelled;
            synchronized (lock) {
                cancelled = cancel;
            }
            String path = save(full && !cancelled);
            setStatus((cancelled ? "멈춤. " : "끝. ") + done + "개 중 " + pass + "개 됨. 저장: " + path);
            Hud.toast("디코더 진단 " + (cancelled ? "멈춤" : "끝") + ": " + pass + " / " + done + " 됨", 5);
        } catch (RuntimeException e) {
            Log.e(TAG, "[video] diag run failed", e);
            setStatus("진단 중 오류: " + e);
        } finally {
            synchronized (lock) {
                running = false;
                current = "";
            }
            // Close the last test video and show the results on the diagnostics page.
            NativeBridge.nativeCloseMedia();
            UiPages.open(DiagPage.ID);
            invalidate();
        }
    }

    private static DiagReport.Entry measureWithRetry(String file, List<DiagReport.CodecInfo> cl, int capSeconds) {
        for (int attempt = 0; attempt < 2; attempt++) {
            DiagReport.Entry e = measure(file, cl, capSeconds);
            if (e == null) return null;
            if (e.r.verdict != DiagJudge.Verdict.INVALID || !e.m.invalidReason.startsWith(INVISIBLE)) return e;
            setStatus("헤드셋 화면이 꺼져 있습니다. 헤드셋을 쓰면 다시 잽니다");
            long until = SystemClock.elapsedRealtime() + 120_000;
            while (!visible() && SystemClock.elapsedRealtime() < until && !cancelled()) SystemClock.sleep(500);
            if (attempt == 1 || cancelled()) return e;
        }
        return null;
    }

    private static final String INVISIBLE = "헤드셋 화면이 꺼짐";

    private static boolean visible() {
        synchronized (VideoPlayer.state) {
            return VideoPlayer.state.sessionVisible;
        }
    }

    private static boolean cancelled() {
        synchronized (lock) {
            return cancel;
        }
    }

    /**
     * Plays one test file through the video viewer and measures it. null = native not running.
     *
     * @param capSeconds stop this many seconds after the first frame; 0 = play to the end of the file
     */
    private static DiagReport.Entry measure(String file, List<DiagReport.CodecInfo> cl, int capSeconds) {
        DiagTests.Spec spec = DiagTests.forFile(file);
        File f = new File(testsDir(), file);
        DiagJudge.Measurement m = new DiagJudge.Measurement();
        m.testId = spec.id;
        m.file = file;
        m.thermalStart = thermalStatus();
        m.batteryTempStartC = batteryTempC();
        DiagTimeline timeline = new DiagTimeline();

        long prevGen;
        synchronized (VideoPlayer.state) {
            prevGen = VideoPlayer.state.gen;
        }
        setStatus("여는 중");
        if (!NativeBridge.nativeOpenMedia("file://" + f.getAbsolutePath(), file, "", "diag", "", -1, f.length())) {
            setStatus("앱 네이티브 쪽이 돌고 있지 않습니다");
            return null;
        }
        long t0 = SystemClock.elapsedRealtime();
        long gen = -1;
        long firstFrameAt = -1;
        long durationMs = -1;
        long limitMs = (DiagTests.MEASURE_SECONDS + 25) * 1000L;
        while (true) {
            SystemClock.sleep(100);
            long now = SystemClock.elapsedRealtime();
            synchronized (VideoPlayer.state) {
                VideoState s = VideoPlayer.state;
                if (gen < 0) {
                    if (s.gen != prevGen && file.equals(s.name)) gen = s.gen;
                    else if (now - t0 > 10_000) {
                        m.error = "재생기가 파일을 열지 않음(10초)";
                        break;
                    } else {
                        continue;
                    }
                }
                if (s.gen != gen) {
                    m.invalidReason = "측정 중 다른 파일이 열림";
                    break;
                }
                if (!s.sessionVisible) {
                    m.invalidReason = INVISIBLE + "(측정 중단)";
                    break;
                }
                if (!s.error.isEmpty()) {
                    m.error = s.error;
                    break;
                }
                if (s.firstFrameMs >= 0 && firstFrameAt < 0) firstFrameAt = now;
                if (firstFrameAt < 0 && now - t0 > 20_000) {
                    m.error = "첫 화면이 20초 안에 나오지 않음";
                    break;
                }
                if (s.durationMs > 0 && durationMs != s.durationMs) {
                    // Follow the file: its length plus slack for a slow decoder, or the cap.
                    durationMs = s.durationMs;
                    limitMs = Math.min(durationMs + 25_000L, DiagTests.MAX_MEASURE_SECONDS * 1000L);
                }
                if (capSeconds > 0) limitMs = Math.min(limitMs, capSeconds * 1000L);
                timeline.add(firstFrameAt < 0 ? -1 : now - firstFrameAt, s.droppedFrames, s.renderedFrames);
                if (s.playbackState == 4 /* ENDED */) break;
                if (firstFrameAt >= 0 && now - firstFrameAt >= limitMs) break;
            }
            if (cancelled()) {
                m.invalidReason = "사람이 멈춤";
                break;
            }
            setStatusQuiet(firstFrameAt < 0 ? "첫 화면 기다리는 중"
                    : "재생 중 " + (now - firstFrameAt) / 1000 + " / " + limitShown(durationMs, capSeconds) + "초");
        }
        SystemClock.sleep(400);  // one more stats push from the player thread
        long endAt = SystemClock.elapsedRealtime();
        synchronized (VideoPlayer.state) {
            VideoState s = VideoPlayer.state;
            if (s.gen == gen) {
                // the last reading belongs to the second the loop stopped in, not the 400 ms wait
                timeline.add(firstFrameAt < 0 ? -1 : Math.max(0, endAt - 400 - firstFrameAt), s.droppedFrames,
                        s.renderedFrames);
                m.decoderName = s.decoderName;
                m.videoMime = s.mime;
                m.videoCodecs = s.codecs;
                m.width = s.width;
                m.height = s.height;
                m.fps = s.fps > 0 ? s.fps : 0;
                m.firstFrameMs = s.firstFrameMs;
                m.playedSeconds = s.positionMs / 1000.0;
                m.renderedFrames = s.renderedFrames;
                m.droppedFrames = s.droppedFrames;
                m.skippedFrames = s.skippedFrames;
                m.maxConsecutiveDropped = s.maxConsecutiveDropped;
                m.audioDecoderName = s.audioDecoderName;
                m.audioOutputBuffers = s.audioOutputBuffers;
                if (m.error.isEmpty() && !s.error.isEmpty()) m.error = s.error;
            }
        }
        m.droppedPerSecond.addAll(timeline.droppedPerSecond());
        m.renderedPerSecond.addAll(timeline.renderedPerSecond());
        m.targetSeconds = DiagTests.targetSeconds(capSeconds, durationMs);
        m.thermalEnd = thermalStatus();
        m.batteryTempEndC = batteryTempC();
        m.hardware = hardwareOf(m.decoderName, cl);
        DiagJudge.Result r = DiagJudge.judge(m, spec.fps);
        Log.i(TAG, "[video] diag " + spec.id + " " + r.verdict + " " + r.reason + " decoder=" + m.decoderName
                + " rendered=" + m.renderedFrames + " dropped=" + m.droppedFrames);
        return new DiagReport.Entry(spec, m, r);
    }

    private static long limitShown(long durationMs, int capSeconds) {
        long len = durationMs > 0 ? durationMs / 1000 : DiagTests.MEASURE_SECONDS;
        return capSeconds > 0 ? Math.min(len, capSeconds) : len;
    }

    /** PowerManager thermal status (0 none .. 6 shutdown), -1 when unknown. */
    private static int thermalStatus() {
        if (appContext == null || Build.VERSION.SDK_INT < 29) return -1;
        try {
            PowerManager pm = (PowerManager) appContext.getSystemService(Context.POWER_SERVICE);
            return pm == null ? -1 : pm.getCurrentThermalStatus();
        } catch (RuntimeException e) {
            return -1;
        }
    }

    /** Battery temperature in °C from the sticky battery broadcast, NaN when unknown. */
    private static double batteryTempC() {
        if (appContext == null) return Double.NaN;
        try {
            Intent b = appContext.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            int t = b == null ? Integer.MIN_VALUE : b.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Integer.MIN_VALUE);
            return t == Integer.MIN_VALUE ? Double.NaN : t / 10.0;
        } catch (RuntimeException e) {
            return Double.NaN;
        }
    }

    private static void setStatusQuiet(String s) {
        synchronized (lock) {
            status = s;
        }
    }

    static Boolean hardwareOf(String decoderName, List<DiagReport.CodecInfo> cl) {
        if (decoderName == null || decoderName.isEmpty()) return null;
        for (DiagReport.CodecInfo c : cl) {
            if (decoderName.equals(c.name) || decoderName.equals(c.canonicalName)) return c.hardware;
        }
        return null;
    }

    // ------------------------------------------------------------------ files

    private static String stamp() {
        return new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(new Date());
    }

    private static String appVersion() {
        try {
            return appContext.getPackageManager().getPackageInfo(appContext.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "?";
        }
    }

    /** Writes decoder-diag-STAMP.json/.md and latest.json/.md; markDone also writes last-run.txt. */
    private static String save(boolean markDone) {
        List<DiagReport.Entry> entries;
        List<DiagReport.CodecInfo> cl;
        String st;
        synchronized (lock) {
            entries = new ArrayList<>(results.values());
            cl = codecs == null ? new ArrayList<>() : codecs;
            st = runStamp.isEmpty() ? stamp() : runStamp;
        }
        String created = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ", Locale.ROOT).format(new Date());
        Map<String, Object> dev = CodecReport.device(appContext);
        String json = DiagReport.json(DiagReport.build(appVersion(), created, dev, cl, entries));
        String md = DiagReport.markdown(appVersion(), created, dev, cl, entries);
        String name = "decoder-diag-" + st;
        try {
            write(new File(baseDir, name + ".json"), json);
            write(new File(baseDir, name + ".md"), md);
            write(new File(baseDir, "latest.json"), json);
            write(new File(baseDir, "latest.md"), md);
            if (markDone) {
                int pass = 0;
                for (DiagReport.Entry e : entries) if (e.r.verdict == DiagJudge.Verdict.PASS) pass++;
                write(new File(baseDir, DONE_FILE), "done " + st + " " + pass + "/" + entries.size() + "\n");
            }
        } catch (IOException e) {
            Log.e(TAG, "[video] diag: save failed", e);
            return "저장 실패: " + e.getMessage();
        }
        synchronized (lock) {
            lastSaved = "files/diagnostics/" + name + ".md";
        }
        return "files/diagnostics/" + name + ".json";
    }

    private static void write(File f, String text) throws IOException {
        try (Writer w = new OutputStreamWriter(new FileOutputStream(f), StandardCharsets.UTF_8)) {
            w.write(text);
        }
    }
}
