package com.sharp.questnative.video;

import android.content.Context;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.ParcelFileDescriptor;
import android.util.Log;
import android.view.Surface;

import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.FileDescriptorDataSource;
import androidx.media3.exoplayer.DecoderCounters;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.analytics.AnalyticsListener;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;

import java.util.HashMap;

/**
 * Media3 ExoPlayer that decodes straight into the Surface of an OpenXR Android-Surface swapchain.
 * Frames never pass through the app's Vulkan renderer: decoder -> Surface -> compositor layer.
 *
 * Threads: native calls the static methods below from the render thread; every call is posted to
 * one "qn-video" HandlerThread that owns the player. Results go back through the native* methods
 * (implemented in cpp/video/video_module.cpp), which only copy values and post to the render thread.
 * Each open() carries a generation number; callbacks for an older generation are ignored natively.
 * Owner: video-dev.
 */
@OptIn(markerClass = UnstableApi.class)
public final class VideoPlayer {
    private static final String TAG = "QuestNative";

    // command() codes, mirrored in video_module.cpp (enum JavaCmd).
    public static final int CMD_PLAY = 1;
    public static final int CMD_PAUSE = 2;
    public static final int CMD_SEEK_TO_MS = 3;
    public static final int CMD_SPEED = 4;
    public static final int CMD_VOLUME = 5;
    public static final int CMD_LOOP = 6;
    public static final int CMD_MUTE = 7;
    public static final int CMD_SAVE_ZOOM = 8;

    private static final long POLL_MS = 200;

    private static HandlerThread thread;
    private static Handler handler;
    private static Context appContext;
    private static VideoPrefs prefs;

    // Owned by the handler thread.
    private static Session current;

    /** What the HUD shows. Written by the player thread and native, read by the ui draw thread. */
    static final VideoState state = new VideoState();

    private VideoPlayer() {}

    /** Called from Module.onCreate (main thread). */
    static synchronized void init(Context context) {
        if (thread != null) return;
        appContext = context.getApplicationContext();
        prefs = new VideoPrefs(appContext);
        thread = new HandlerThread("qn-video");
        thread.start();
        handler = new Handler(thread.getLooper());
    }

    static synchronized void shutdown() {
        if (thread == null) return;
        Handler h = handler;
        h.post(() -> {
            if (current != null) current.release(false);
            current = null;
        });
        thread.quitSafely();
        thread = null;
        handler = null;
    }

    private static boolean post(Runnable r) {
        Handler h = handler;
        if (h == null) {
            Log.w(TAG, "[video] player thread not running");
            return false;
        }
        return h.post(r);
    }

    // ------------------------------------------------------------------ called from native

    /** Starts loading. fd >= 0 is owned by the player from now on (closed on release). */
    public static boolean open(long gen, String uri, int fd, long size, String name, String mime, String sourceId,
                               String layoutHint) {
        ParcelFileDescriptor pfd = fd >= 0 ? ParcelFileDescriptor.adoptFd(fd) : null;
        boolean ok = post(() -> {
            if (current != null) current.release(true);
            current = new Session(gen, uri, pfd, size, name, mime, sourceId, layoutHint);
            current.start();
        });
        if (!ok && pfd != null) closeQuietly(pfd);
        return ok;
    }

    public static void attachSurface(long gen, Surface surface) {
        post(() -> {
            if (current != null && current.gen == gen) current.attachSurface(surface);
        });
    }

    public static void command(long gen, int cmd, double value) {
        post(() -> {
            if (current != null && current.gen == gen) current.command(cmd, value);
        });
    }

    /** The person picked a layout by hand: remember it for this item. */
    public static void rememberLayout(long gen, String layout) {
        post(() -> {
            if (current != null && current.gen == gen) prefs.rememberLayout(current.itemKey, layout);
        });
    }

    /** Layout / eye swap / zoom live in C++ (they drive the layers); native mirrors them here for the HUD. */
    public static void setViewState(long gen, String layout, boolean swapEyes, float zoom) {
        synchronized (state) {
            if (state.gen != gen) return;
            state.layout = layout;
            state.swapEyes = swapEyes;
            state.zoom = zoom;
        }
        VideoHud.invalidate();
    }

    /** Releases the player; nativeOnReleased(gen) follows once the Surface is no longer used. */
    public static void close(long gen) {
        boolean ok = post(() -> {
            if (current != null && current.gen == gen) {
                current.release(true);
                current = null;
            } else {
                nativeOnReleased(gen);
            }
        });
        if (!ok) nativeOnReleased(gen);
    }

    // ------------------------------------------------------------------ native callbacks

    static native void nativeOnFormat(long gen, int width, int height, float fps, String mime, String codecs,
                                      String layout, String confidence, String reasons, boolean fromMemory,
                                      float screenZoom);

    static native void nativeOnLayoutRefined(long gen, String layout, String confidence, String reasons);

    static native void nativeOnState(long gen, int playbackState, boolean playing, boolean playWhenReady,
                                     long positionMs, long durationMs, long bufferedMs, float speed, float volume,
                                     boolean muted, boolean loop);

    static native void nativeOnStats(long gen, String decoderName, long renderedFrames, long droppedFrames,
                                     long skippedFrames, int maxConsecutiveDropped, long droppedToKeyframe);

    static native void nativeOnError(long gen, String message);

    static native void nativeOnReleased(long gen);

    /** HUD commands for view state kept in C++ (layout, swapEyes, recenter, zoomIn, zoomOut). */
    static native void nativeOnHudAction(long gen, String id, float value, int phase);

    // ------------------------------------------------------------------ session

    private static void closeQuietly(ParcelFileDescriptor pfd) {
        try {
            pfd.close();
        } catch (Exception ignored) {
            // nothing to do
        }
    }

    private static final class Session implements Player.Listener, AnalyticsListener {
        final long gen;
        final String uri, name, mime, sourceId, layoutHint, itemKey;
        final long size;
        ParcelFileDescriptor pfd;
        ExoPlayer player;
        Surface surface;
        boolean formatSent;
        boolean layoutLocked;  // hint or memory decided the layout: no sniff refinement
        String decoderName = "";
        float volume, speed;
        boolean muted, loop;
        final Runnable poll = this::pollAndReschedule;

        Session(long gen, String uri, ParcelFileDescriptor pfd, long size, String name, String mime, String sourceId,
                String layoutHint) {
            this.gen = gen;
            this.uri = uri == null ? "" : uri;
            this.pfd = pfd;
            this.size = size;
            this.name = name == null ? "" : name;
            this.mime = mime == null ? "" : mime;
            this.sourceId = sourceId == null ? "" : sourceId;
            this.layoutHint = layoutHint == null ? "" : layoutHint;
            this.itemKey = VideoPrefs.itemKey(sourceId, uri, name);
            volume = clamp(prefs.getFloat("volume", 1f), 0f, 1f);
            speed = clamp(prefs.getFloat("speed", 1f), 0.25f, 4f);
            muted = prefs.getBool("muted", false);
            loop = prefs.getBool("loop", true);
        }

        void start() {
            synchronized (state) {
                state.reset(gen, name);
            }
            ExoPlayer p = new ExoPlayer.Builder(appContext).setLooper(thread.getLooper()).build();
            player = p;
            p.addListener(this);
            p.addAnalyticsListener(this);
            p.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true);
            p.setRepeatMode(loop ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
            p.setVolume(muted ? 0f : volume);
            p.setPlaybackParameters(new PlaybackParameters(speed));
            try {
                if (pfd != null) {
                    final java.io.FileDescriptor fd = pfd.getFileDescriptor();
                    final long len = size > 0 ? size : (pfd.getStatSize() > 0 ? pfd.getStatSize() : C.LENGTH_UNSET);
                    MediaSource src = new ProgressiveMediaSource.Factory(() -> new FileDescriptorDataSource(fd, 0, len))
                            .createMediaSource(MediaItem.fromUri(Uri.parse("fd://" + pfd.getFd())));
                    p.setMediaSource(src);
                } else {
                    p.setMediaItem(MediaItem.fromUri(Uri.parse(uri)));
                }
            } catch (Exception e) {
                nativeOnError(gen, "열 수 없음: " + e.getMessage());
                return;
            }
            // Start playing once the Surface is attached, so the first frames are not dropped.
            p.setPlayWhenReady(false);
            p.prepare();
            handler.postDelayed(poll, POLL_MS);
            Log.i(TAG, "[video] gen " + gen + " preparing " + name);
        }

        void attachSurface(Surface s) {
            surface = s;
            if (player == null) return;
            player.setVideoSurface(s);
            player.setPlayWhenReady(true);
        }

        void command(int cmd, double value) {
            if (player == null) return;
            switch (cmd) {
                case CMD_PLAY:
                    if (player.getPlaybackState() == Player.STATE_ENDED) player.seekTo(0);
                    player.setPlayWhenReady(true);
                    break;
                case CMD_PAUSE:
                    player.setPlayWhenReady(false);
                    break;
                case CMD_SEEK_TO_MS: {
                    long dur = player.getDuration();
                    long to = Math.max(0, (long) value);
                    if (dur != C.TIME_UNSET) to = Math.min(to, Math.max(0, dur - 1));
                    player.seekTo(to);
                    break;
                }
                case CMD_SPEED:
                    speed = clamp((float) value, 0.25f, 4f);
                    player.setPlaybackParameters(new PlaybackParameters(speed));
                    prefs.putFloat("speed", speed);
                    break;
                case CMD_VOLUME:
                    volume = clamp((float) value, 0f, 1f);
                    if (volume > 0) muted = false;
                    player.setVolume(muted ? 0f : volume);
                    prefs.putFloat("volume", volume);
                    prefs.putBool("muted", muted);
                    break;
                case CMD_MUTE:
                    muted = value != 0;
                    player.setVolume(muted ? 0f : volume);
                    prefs.putBool("muted", muted);
                    break;
                case CMD_LOOP:
                    loop = value != 0;
                    player.setRepeatMode(loop ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
                    prefs.putBool("loop", loop);
                    break;
                case CMD_SAVE_ZOOM:
                    prefs.putFloat("screenZoom", (float) value);
                    break;
                default:
                    break;
            }
            pushState();
            VideoHud.invalidate();
        }

        void release(boolean notifyNative) {
            handler.removeCallbacks(poll);
            if (player != null) {
                player.removeListener(this);
                player.removeAnalyticsListener(this);
                player.release();  // detaches the Surface; the producer is done with it after this
                player = null;
            }
            if (pfd != null) {
                closeQuietly(pfd);
                pfd = null;
            }
            surface = null;
            synchronized (state) {
                if (state.gen == gen) state.open = false;
            }
            if (notifyNative) nativeOnReleased(gen);
        }

        // ---- state push

        void pollAndReschedule() {
            pushState();
            pushStats();
            handler.postDelayed(poll, POLL_MS);
        }

        void pushState() {
            if (player == null) return;
            long dur = player.getDuration();
            synchronized (state) {
                state.playbackState = player.getPlaybackState();
                state.playWhenReady = player.getPlayWhenReady();
                state.positionMs = player.getCurrentPosition();
                state.durationMs = dur == C.TIME_UNSET ? -1 : dur;
                state.bufferedMs = player.getBufferedPosition();
                state.speed = speed;
                state.volume = volume;
                state.muted = muted;
                state.loop = loop;
            }
            nativeOnState(gen, player.getPlaybackState(), player.isPlaying(), player.getPlayWhenReady(),
                    player.getCurrentPosition(), dur == C.TIME_UNSET ? -1 : dur, player.getBufferedPosition(),
                    speed, volume, muted, loop);
        }

        void pushStats() {
            if (player == null) return;
            DecoderCounters c = player.getVideoDecoderCounters();
            if (c == null) return;
            c.ensureUpdated();
            synchronized (state) {
                state.decoderName = decoderName;
                state.renderedFrames = c.renderedOutputBufferCount;
                state.droppedFrames = c.droppedBufferCount;
                state.skippedFrames = c.skippedOutputBufferCount;
                state.maxConsecutiveDropped = c.maxConsecutiveDroppedBufferCount;
            }
            nativeOnStats(gen, decoderName, c.renderedOutputBufferCount, c.droppedBufferCount,
                    c.skippedOutputBufferCount, c.maxConsecutiveDroppedBufferCount, c.droppedToKeyframeCount);
        }

        // ---- format detection

        @Override
        public void onTracksChanged(Tracks tracks) {
            if (formatSent) return;
            Format video = null;
            for (Tracks.Group g : tracks.getGroups()) {
                if (g.getType() != C.TRACK_TYPE_VIDEO) continue;
                for (int i = 0; i < g.length; i++) {
                    if (g.isTrackSelected(i)) {
                        video = g.getTrackFormat(i);
                        break;
                    }
                }
                if (video != null) break;
            }
            if (video == null) {
                if (!tracks.isEmpty()) {
                    synchronized (state) {
                        state.error = "영상 트랙이 없습니다";
                    }
                    nativeOnError(gen, "영상 트랙이 없거나 이 기기가 디코딩할 수 없는 영상입니다.");
                }
                return;
            }
            formatSent = true;
            FormatDetect.Spatial spatial = SpatialMeta.fromFormat(video.stereoMode, video.projectionData);
            FormatDetect.Result detected = FormatDetect.detect(name, video.width, video.height, spatial);
            String layout = detected.layout;
            String confidence = detected.confidence;
            String reasons = detected.reasonText();
            boolean fromMemory = false;
            String remembered = prefs.recallLayout(itemKey);
            if (FormatDetect.isLayout(layoutHint)) {
                layout = layoutHint;
                confidence = "high";
                reasons = "보관함 형식";
                layoutLocked = true;
            } else if (remembered != null) {
                layout = remembered;
                confidence = "high";
                reasons = "이 파일에 고른 형식(기억)";
                fromMemory = true;
                layoutLocked = true;
            }
            float zoom = prefs.getFloat("screenZoom", 0f);
            synchronized (state) {
                state.width = video.width;
                state.height = video.height;
                state.fps = video.frameRate;
                state.mime = nz(video.sampleMimeType);
                state.codecs = nz(video.codecs);
                state.layout = layout;
                state.confidence = confidence;
                state.reasons = reasons;
            }
            Log.i(TAG, "[video] format " + video.width + "x" + video.height + " " + video.sampleMimeType + " "
                    + video.codecs + " fps=" + video.frameRate + " stereo=" + video.stereoMode + " -> " + layout
                    + " (" + confidence + ": " + reasons + ")");
            nativeOnFormat(gen, video.width, video.height, video.frameRate, nz(video.sampleMimeType), nz(video.codecs),
                    layout, confidence, reasons, fromMemory, zoom);
            if (!layoutLocked && "low".equals(confidence)) sniffLater(detected, video.width, video.height);
        }

        /** Grabs one small frame off-thread and refines a ratio-only guess (quest-app sniffStereo). */
        void sniffLater(FormatDetect.Result detected, int width, int height) {
            final String path = pfd != null ? "/proc/self/fd/" + pfd.getFd() : null;
            final long g = gen;
            Thread t = new Thread(() -> {
                MediaMetadataRetriever mmr = new MediaMetadataRetriever();
                try {
                    if (path != null) mmr.setDataSource(path);
                    else if (uri.startsWith("http")) mmr.setDataSource(uri, new HashMap<>());
                    else mmr.setDataSource(appContext, Uri.parse(uri));
                    Bitmap bmp = mmr.getScaledFrameAtTime(1_000_000L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 256,
                            256);
                    if (bmp == null) return;
                    int w = bmp.getWidth(), h = bmp.getHeight();
                    int[] px = new int[w * h];
                    bmp.getPixels(px, 0, w, 0, 0, w, h);
                    bmp.recycle();
                    for (int i = 0; i < px.length; i++) {
                        int c = px[i];
                        px[i] = (int) (0.299 * ((c >> 16) & 0xFF) + 0.587 * ((c >> 8) & 0xFF) + 0.114 * (c & 0xFF));
                    }
                    String sniff = FormatDetect.sniffStereo(px, w, h);
                    FormatDetect.Result refined = FormatDetect.refineWithSniff(detected, sniff,
                            height > 0 ? (double) width / height : 0);
                    Log.i(TAG, "[video] sniff=" + sniff + " -> " + refined.layout);
                    if (refined != detected) {
                        synchronized (state) {
                            if (state.gen == g) {
                                state.confidence = refined.confidence;
                                state.reasons = refined.reasonText();
                            }
                        }
                        nativeOnLayoutRefined(g, refined.layout, refined.confidence,
                            refined.reasonText());
                    }
                } catch (Exception e) {
                    Log.w(TAG, "[video] frame sniff skipped: " + e.getMessage());
                } finally {
                    try {
                        mmr.release();
                    } catch (Exception ignored) {
                        // nothing
                    }
                }
            }, "qn-video-sniff");
            t.setDaemon(true);
            t.start();
        }

        // ---- player events

        @Override
        public void onPlaybackStateChanged(int state) {
            pushState();
        }

        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            pushState();
        }

        @Override
        public void onPlayerError(PlaybackException error) {
            String msg = error.getErrorCodeName() + ": " + error.getMessage();
            Log.e(TAG, "[video] " + msg, error);
            synchronized (state) {
                state.error = msg;
            }
            nativeOnError(gen, msg);
        }

        @Override
        public void onVideoDecoderInitialized(EventTime eventTime, String name,
                                              long initializedTimestampMs, long initializationDurationMs) {
            decoderName = name;
            Log.i(TAG, "[video] decoder " + name + " (" + initializationDurationMs + " ms)");
            pushStats();
        }

        @Override
        public void onDroppedVideoFrames(EventTime eventTime, int droppedFrames, long elapsedMs) {
            pushStats();
        }
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    private static float clamp(float v, float lo, float hi) {
        return Float.isNaN(v) ? lo : Math.max(lo, Math.min(hi, v));
    }
}
