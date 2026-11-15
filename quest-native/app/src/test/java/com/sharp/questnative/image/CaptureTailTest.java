package com.sharp.questnative.image;

import org.junit.Test;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.channels.SeekableByteChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import static org.junit.Assert.*;

public class CaptureTailTest {
    private static void u32(ByteArrayOutputStream out, int n) {
        byte[] b = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(n).array();
        out.write(b, 0, b.length);
    }
    private static byte[] fixture() { return fixture(0); }
    private static byte[] fixture(int unsupportedField) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] prefix = { (byte) 0xff, (byte) 0xd8, (byte) 0xff, (byte) 0xd9 };
        out.write(prefix, 0, prefix.length);
        ByteArrayOutputStream metadata = new ByteArrayOutputStream();
        byte[] old = { 0x2a, 3, 'a', 'b', 'c' };
        metadata.write(old, 0, old.length);
        if (unsupportedField != 0) {
            int tag = (unsupportedField << 3) | 2;
            metadata.write((tag & 127) | 128); metadata.write(tag >>> 7); metadata.write(0);
        }
        byte[] meta = metadata.toByteArray();
        out.write(meta, 0, meta.length);
        out.write(0); out.write(1); u32(out, meta.length);
        for (int i = 0; i < 32; i++) out.write(0);
        u32(out, 72 + 6 + meta.length); u32(out, 3);
        byte[] magic = "8db42d694ccc418790edff439fe026bf".getBytes(StandardCharsets.US_ASCII);
        out.write(magic, 0, magic.length);
        return out.toByteArray();
    }
    private static CaptureTail.Result parse(byte[] bytes) throws Exception {
        Path path = Files.createTempFile("capture-tail", ".bin");
        try {
            Files.write(path, bytes);
            try (SeekableByteChannel ch = Files.newByteChannel(path, StandardOpenOption.READ)) {
                return CaptureTail.parse(ch);
            }
        } finally { Files.deleteIfExists(path); }
    }
    @Test public void validTrailerAndCalibration() throws Exception {
        CaptureTail.Result r = parse(fixture());
        assertNotNull(r); assertEquals(3, r.version); assertEquals("abc", r.calibration);
    }
    @Test public void missingOrTruncatedTrailer() throws Exception {
        byte[] b = fixture();
        assertNull(parse(new byte[10]));
        b[b.length - 1] ^= 1;
        assertNull(parse(b));
    }
    @Test public void forgedSizesRejected() throws Exception {
        byte[] b = fixture();
        b[b.length - 40] = (byte) 255; b[b.length - 39] = (byte) 255;
        assertNull(parse(b));
        b = fixture(); b[12] = (byte) 255; b[13] = (byte) 255;
        assertNull(parse(b));
    }
    @Test public void newerCalibrationFieldsAreRejected() throws Exception {
        for (int field : new int[] {53, 54, 111}) assertNull(parse(fixture(field)));
    }
    @Test public void malformedMetadataDoesNotExposeCalibration() throws Exception {
        byte[] b = fixture(); b[5] = 100;
        assertNull(parse(b));
    }
}
