package com.sharp.questnative.video;

import com.sharp.questnative.ui.hud.Hud;
import com.sharp.questnative.ui.hud.HudControl;
import com.sharp.questnative.ui.hud.HudModel;
import com.sharp.questnative.ui.hud.HudProvider;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Video HUD as data (module-contract.md §14). The ui module draws it; this class only describes
 * the controls and turns the person's actions into player commands. Runs on the ui draw thread.
 * Control ids follow §14.5 so the button-mapping screen can target the same actions.
 * Owner: video-dev.
 */
final class VideoHud implements HudProvider {
    private static final List<String> LAYOUT_LABELS = new ArrayList<>();

    static {
        for (String l : FormatDetect.LAYOUT_ORDER) LAYOUT_LABELS.add(FormatDetect.label(l));
    }

    static void invalidate() {
        Hud.invalidate();
    }

    @Override
    public HudModel describe() {
        if (DiagRunner.hudActive()) return DiagRunner.describe();
        HudModel m = new HudModel();
        synchronized (VideoPlayer.state) {
            VideoState s = VideoPlayer.state;
            m.title = s.name;
            if (!s.open) {
                m.status = "영상이 열려 있지 않습니다";
                return m;
            }
            StringBuilder sub = new StringBuilder(FormatDetect.label(s.layout));
            if (s.width > 0) sub.append(" · ").append(s.width).append('×').append(s.height);
            if (s.fps > 0) sub.append(String.format(Locale.ROOT, " · %.0ffps", s.fps));
            m.subtitle = sub.toString();
            if (!s.error.isEmpty()) m.status = "오류: " + s.error;
            else if (s.playbackState == 2) m.status = "불러오는 중…";
            else if ("low".equals(s.confidence)) m.status = "형식 추정: " + s.reasons + " — 맞지 않으면 [형식]을 바꾸세요";

            float durS = s.durationMs > 0 ? s.durationMs / 1000f : 0;
            float posS = Float.isNaN(s.previewSeekS) ? s.positionMs / 1000f : s.previewSeekS;
            boolean playing = s.playWhenReady && s.playbackState != 4;

            // main page
            HudControl seek = HudControl.seek("seek", posS, durS, s.bufferedMs / 1000f, 0);
            seek.enabled = durS > 0;
            m.add(seek);
            m.add(HudControl.button("back10", "10초 뒤로", "back10", 1));
            HudControl play = HudControl.toggle("play", playing ? "일시정지" : "재생", playing, 1);
            play.icon = playing ? "pause" : "play";
            m.add(play);
            m.add(HudControl.button("fwd10", "10초 앞으로", "fwd10", 1));
            HudControl speed = HudControl.slider("speed", "배속", s.speed, 0.5f, 2f, 0.25f, "x", 2);
            speed.icon = "speed";
            m.add(speed);
            HudControl vol = HudControl.slider("volume", "음량", s.muted ? 0 : s.volume, 0f, 1f, 0f, "percent", 2);
            vol.icon = s.muted ? "mute" : "volume";
            m.add(vol);

            // more page
            int layoutIndex = Math.max(0, FormatDetect.LAYOUT_ORDER.indexOf(s.layout));
            m.add(HudControl.choice("layout", "형식", LAYOUT_LABELS, layoutIndex, 0).onPage("more"));
            m.add(HudControl.toggle("mute", "소리 끔", s.muted, 1).onPage("more"));
            m.add(HudControl.toggle("loop", "반복", s.loop, 1).onPage("more"));
            m.add(HudControl.toggle("swapEyes", "눈 바꿈", s.swapEyes, 1).onPage("more"));
            m.add(HudControl.button("recenter", "위치 맞춤", "recenter", 2).onPage("more"));
            m.add(HudControl.button("zoomOut", "작게", "zoomOut", 2).onPage("more"));
            m.add(HudControl.button("zoomIn", "크게", "zoomIn", 2).onPage("more"));

            // diagnostics (shown only when the person turns them on)
            m.diagnostics.add("디코더: " + (s.decoderName.isEmpty() ? "-" : s.decoderName));
            m.diagnostics.add("코덱: " + s.mime + (s.codecs.isEmpty() ? "" : " (" + s.codecs + ")"));
            m.diagnostics.add(String.format(Locale.ROOT, "프레임: 표시 %d · 버림 %d · 건너뜀 %d · 최대 연속 버림 %d",
                    s.renderedFrames, s.droppedFrames, s.skippedFrames, s.maxConsecutiveDropped));
            m.diagnostics.add(String.format(Locale.ROOT, "버퍼: %.1f초 앞까지", Math.max(0,
                    (s.bufferedMs - s.positionMs) / 1000f)));
            m.diagnostics.add("형식 판단: " + s.confidence + " · " + s.reasons);
        }
        return m;
    }

    @Override
    public void onAction(String id, float value, int phase) {
        if (DiagRunner.hudActive()) {
            DiagRunner.onAction(id, value, phase);
            return;
        }
        long gen;
        long posMs;
        synchronized (VideoPlayer.state) {
            VideoState s = VideoPlayer.state;
            if (!s.open) return;
            gen = s.gen;
            posMs = s.positionMs;
            if ("seek".equals(id)) s.previewSeekS = phase == Hud.PHASE_CHANGE ? value : Float.NaN;
            if ("seek".equals(id) && phase == Hud.PHASE_COMMIT) s.positionMs = (long) (value * 1000);
        }
        boolean commit = phase == Hud.PHASE_COMMIT;
        switch (id) {
            case "play":
                VideoPlayer.command(gen, value != 0 ? VideoPlayer.CMD_PLAY : VideoPlayer.CMD_PAUSE, 0);
                break;
            case "seek":
                if (commit) VideoPlayer.command(gen, VideoPlayer.CMD_SEEK_TO_MS, value * 1000.0);
                break;
            case "back10":
                VideoPlayer.command(gen, VideoPlayer.CMD_SEEK_TO_MS, Math.max(0, posMs - 10000));
                break;
            case "fwd10":
                VideoPlayer.command(gen, VideoPlayer.CMD_SEEK_TO_MS, posMs + 10000);
                break;
            case "speed":
                if (commit) VideoPlayer.command(gen, VideoPlayer.CMD_SPEED, value);
                break;
            case "volume":
                VideoPlayer.command(gen, VideoPlayer.CMD_VOLUME, value);  // cheap; follow the drag
                break;
            case "mute":
                VideoPlayer.command(gen, VideoPlayer.CMD_MUTE, value);
                break;
            case "loop":
                VideoPlayer.command(gen, VideoPlayer.CMD_LOOP, value);
                break;
            case "layout":
            case "swapEyes":
            case "recenter":
            case "zoomIn":
            case "zoomOut":
                if (commit) VideoPlayer.nativeOnHudAction(gen, id, value, phase);
                break;
            default:
                return;
        }
        Hud.invalidate();
    }
}
