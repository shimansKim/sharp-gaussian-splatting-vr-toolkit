package com.sharp.questnative.source;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * Download cache for files that the viewers can only open from a file descriptor (photos, PLY).
 * One file per (url, size, mtime); a changed file on the PC gets a new name. Least recently used
 * files are removed when the folder grows past the limit. Plain Java so it runs in JVM tests.
 * Owner: encode-guide.
 */
public final class PcCache {
    public interface Progress {
        /** done/total bytes (total -1 when unknown). Called at most every few hundred ms. */
        void onProgress(long done, long total);
    }

    /** Default cap: 4 GB or a quarter of the free space, whichever is smaller (at least 256 MB). */
    public static long defaultLimit(long usableBytes) {
        long quarter = usableBytes / 4;
        return Math.max(256L << 20, Math.min(4L << 30, quarter));
    }

    private final File dir;
    private final long limitBytes;

    public PcCache(File dir, long limitBytes) {
        this.dir = dir;
        this.limitBytes = limitBytes;
    }

    public File dir() {
        return dir;
    }

    /** Stable cache file name: sha1(url|size|mtime) + the original extension. */
    static String key(String url, long size, long mtime, String name) {
        String ext = "";
        int dot = name == null ? -1 : name.lastIndexOf('.');
        if (dot >= 0 && name.length() - dot <= 8) ext = name.substring(dot).toLowerCase(Locale.ROOT);
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] h = md.digest((url + "|" + size + "|" + mtime).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : h) sb.append(String.format(Locale.ROOT, "%02x", b));
            return sb + ext;
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The complete cached copy, or null. Touches it (most recently used). */
    public synchronized File find(String url, long size, long mtime, String name) {
        File f = new File(dir, key(url, size, mtime, name));
        if (!f.isFile()) return null;
        if (size >= 0 && f.length() != size) {
            f.delete();
            return null;
        }
        f.setLastModified(System.currentTimeMillis());
        return f;
    }

    /**
     * Returns the cached copy, downloading it first when needed. The download goes to a ".part" file
     * and is renamed when complete, so a cut connection never leaves a broken file behind.
     */
    public File fetch(String url, long size, long mtime, String name, Progress progress) throws IOException {
        File hit = find(url, size, mtime, name);
        if (hit != null) return hit;
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("cannot create cache " + dir);
        if (size > limitBytes) throw new IOException("file is larger than the cache limit");
        File target = new File(dir, key(url, size, mtime, name));
        File part = new File(dir, target.getName() + ".part");
        // Make room before downloading so the disk does not fill up mid-way.
        trim(size > 0 ? size : 0, target);
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(5000);
            c.setReadTimeout(30000);
            c.setInstanceFollowRedirects(false);
            c.setUseCaches(false);
            int code = c.getResponseCode();
            if (code != 200) throw new PcApi.HttpError(code, "");
            long total = c.getContentLengthLong();
            if (total < 0) total = size;
            long done = 0;
            long lastReport = 0;
            try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                byte[] buf = new byte[256 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    done += n;
                    long now = System.currentTimeMillis();
                    if (progress != null && now - lastReport >= 300) {
                        lastReport = now;
                        progress.onProgress(done, total);
                    }
                    if (Thread.currentThread().isInterrupted()) throw new IOException("download cancelled");
                }
                out.getFD().sync();
            }
            if (total >= 0 && done != total) throw new IOException("download cut short (" + done + "/" + total + ")");
            if (progress != null) progress.onProgress(done, total);
            synchronized (this) {
                if (target.exists()) target.delete();
                if (!part.renameTo(target)) throw new IOException("cannot finish " + target);
            }
            target.setLastModified(System.currentTimeMillis());
            return target;
        } finally {
            c.disconnect();
            if (part.exists()) part.delete();
        }
    }

    /** Total bytes of complete cache files. */
    public synchronized long usedBytes() {
        long sum = 0;
        for (File f : files()) sum += f.length();
        return sum;
    }

    /**
     * Deletes least recently used files until incoming more bytes fit under the limit. keep is never
     * deleted (the file being opened). Stale ".part" files are always removed. An open file
     * descriptor keeps working after its file is deleted, so trimming never breaks a viewer.
     */
    public synchronized void trim(long incoming, File keep) {
        File[] all = dir.listFiles();
        if (all == null) return;
        long now = System.currentTimeMillis();
        for (File f : all) {
            if (f.getName().endsWith(".part") && now - f.lastModified() > 10 * 60 * 1000L) f.delete();
        }
        List<File> list = files();
        list.sort(Comparator.comparingLong(File::lastModified));
        long used = 0;
        for (File f : list) used += f.length();
        for (File f : list) {
            if (used + incoming <= limitBytes) break;
            if (f.equals(keep)) continue;
            long len = f.length();
            if (f.delete()) used -= len;
        }
    }

    /** Removes everything (settings: "캐시 비우기"). */
    public synchronized void clear() {
        File[] all = dir.listFiles();
        if (all != null) for (File f : all) f.delete();
    }

    private List<File> files() {
        File[] all = dir.listFiles();
        List<File> out = new ArrayList<>();
        if (all == null) return out;
        for (File f : Arrays.asList(all)) {
            if (f.isFile() && !f.getName().endsWith(".part")) out.add(f);
        }
        return out;
    }
}
