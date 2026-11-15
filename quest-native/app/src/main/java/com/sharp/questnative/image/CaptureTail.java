package com.sharp.questnative.image;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.channels.SeekableByteChannel;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** Bounded, read-only parser for the reported capture-file trailer; does not parse GPS or thumbnails. */
public final class CaptureTail {
    private static final byte[] MAGIC = "8db42d694ccc418790edff439fe026bf".getBytes(StandardCharsets.US_ASCII);
    private static final int FOOTER = 72, LIMIT = 4 * 1024 * 1024;
    private CaptureTail() {}

    public static final class Result {
        public final int version;
        public final String calibration;
        Result(int version, String calibration) { this.version = version; this.calibration = calibration; }
    }

    private static byte[] read(SeekableByteChannel ch, long pos, int size) throws IOException {
        byte[] out = new byte[size];
        ch.position(pos);
        ByteBuffer b = ByteBuffer.wrap(out);
        while (b.hasRemaining()) if (ch.read(b) <= 0) throw new IOException("truncated trailer");
        return out;
    }

    private static long u32(byte[] b, int off) {
        return Integer.toUnsignedLong(ByteBuffer.wrap(b, off, 4).order(ByteOrder.LITTLE_ENDIAN).getInt());
    }

    /** Returns null for absent, malformed or unsupported trailer; no unbounded allocation. */
    public static Result parse(SeekableByteChannel ch) throws IOException {
        long size = ch.size();
        if (size < FOOTER) return null;
        byte[] footer = read(ch, size - FOOTER, FOOTER);
        if (!Arrays.equals(MAGIC, Arrays.copyOfRange(footer, 40, 72))) return null;
        long total = u32(footer, 32);
        long version = u32(footer, 36);
        if (total < FOOTER || total > size || version != 3) return null;
        long start = size - total, pos = size - FOOTER;
        String calibration = null;
        boolean metadataSeen = false;
        int entries = 0;
        while (pos > start) {
            if (++entries > 65536 || pos - start < 6) return null;
            byte[] desc = read(ch, pos - 6, 6);
            long len = u32(desc, 2);
            long data = pos - 6 - len;
            if (data < start || data > pos - 6) return null;
            if ((desc[1] & 255) == 1) {
                if (len > LIMIT || metadataSeen) return null;
                metadataSeen = true;
                try { calibration = field(read(ch, data, (int) len), 5); }
                catch (IllegalArgumentException malformed) { return null; }
            }
            pos = data;
        }
        return metadataSeen ? new Result((int) version, calibration) : null;
    }

    // Protobuf wire types; skip fields we do not need without interpreting their contents.
    private static String field(byte[] data, int wanted) {
        int[] p = {0};
        String result = null;
        while (p[0] < data.length) {
            long tag = varint(data, p);
            if (tag <= 0) throw new IllegalArgumentException("bad tag");
            int wire = (int) (tag & 7), number = (int) (tag >>> 3);
            // Reported newer offset fields; field numbers have not been checked against a newer camera file.
            if (number == 53 || number == 54 || number == 111)
                throw new IllegalArgumentException("unsupported calibration version");
            if (wire == 0) { if (varint(data, p) < 0) throw new IllegalArgumentException("bad varint"); }
            else if (wire == 1 || wire == 5) {
                int n = wire == 1 ? 8 : 4;
                if (n > data.length - p[0]) throw new IllegalArgumentException("truncated field");
                p[0] += n;
            } else if (wire == 2) {
                long n = varint(data, p);
                if (n < 0 || n > data.length - p[0]) throw new IllegalArgumentException("truncated field");
                if (number == wanted) {
                    if (result != null) throw new IllegalArgumentException("duplicate calibration");
                    result = new String(data, p[0], (int) n, StandardCharsets.UTF_8);
                }
                p[0] += (int) n;
            } else throw new IllegalArgumentException("unsupported wire type");
        }
        return result;
    }

    private static long varint(byte[] data, int[] p) {
        long n = 0;
        for (int i = 0; i < 10 && p[0] < data.length; i++) {
            int b = data[p[0]++] & 255;
            if (i == 9 && b > 1) return -1;
            n |= (long) (b & 127) << (7 * i);
            if ((b & 128) == 0) return n;
        }
        return -1;
    }
}
