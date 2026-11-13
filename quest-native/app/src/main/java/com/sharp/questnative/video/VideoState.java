package com.sharp.questnative.video;

/**
 * Snapshot of the current video for the HUD and the diagnostics screen. Guard every access with
 * synchronized (VideoPlayer.state). Owner: video-dev.
 *
 * Diagnostics fields (next mission): decoderName, renderedFrames, droppedFrames, skippedFrames,
 * maxConsecutiveDropped, mime/codecs, width/height/fps, bufferedMs.
 */
final class VideoState {
    long gen;
    boolean open;
    String name = "";
    // format
    int width, height;
    float fps;
    String mime = "", codecs = "";
    String layout = FormatDetect.MONO2D, confidence = "", reasons = "";
    // view (mirrored from C++)
    boolean swapEyes;
    float zoom;
    // player
    int playbackState = 1;  // Player.STATE_IDLE
    boolean playWhenReady;
    long positionMs, durationMs = -1, bufferedMs;
    float speed = 1, volume = 1;
    boolean muted, loop = true;
    float previewSeekS = Float.NaN;  // HUD seek drag in progress
    // stats
    String decoderName = "";
    long renderedFrames, droppedFrames, skippedFrames;
    int maxConsecutiveDropped;
    String error = "";

    void reset(long gen, String name) {
        VideoState fresh = new VideoState();
        this.gen = gen;
        this.open = true;
        this.name = name;
        width = fresh.width;
        height = fresh.height;
        fps = fresh.fps;
        mime = fresh.mime;
        codecs = fresh.codecs;
        layout = fresh.layout;
        confidence = fresh.confidence;
        reasons = fresh.reasons;
        playbackState = fresh.playbackState;
        playWhenReady = false;
        positionMs = 0;
        durationMs = -1;
        bufferedMs = 0;
        previewSeekS = Float.NaN;
        decoderName = "";
        renderedFrames = droppedFrames = skippedFrames = 0;
        maxConsecutiveDropped = 0;
        error = "";
    }
}
