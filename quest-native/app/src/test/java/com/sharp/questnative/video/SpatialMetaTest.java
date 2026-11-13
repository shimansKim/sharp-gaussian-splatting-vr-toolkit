package com.sharp.questnative.video;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

import org.junit.Test;

/** Media3 Format.stereoMode / projectionData (sv3d "proj" box) -> Spatial. */
public class SpatialMetaTest {
    private static byte[] box(String type, byte[]... children) {
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        for (byte[] c : children) body.write(c, 0, c.length);
        int size = 8 + body.size();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(size >>> 24);
        out.write(size >>> 16);
        out.write(size >>> 8);
        out.write(size);
        byte[] t = type.getBytes(StandardCharsets.US_ASCII);
        out.write(t, 0, 4);
        byte[] b = body.toByteArray();
        out.write(b, 0, b.length);
        return out.toByteArray();
    }

    private static byte[] u32(long v) {
        return new byte[] {(byte) (v >>> 24), (byte) (v >>> 16), (byte) (v >>> 8), (byte) v};
    }

    private static byte[] equi(double top, double bottom, double left, double right) {
        double f = 4294967296.0;
        return box("equi", u32(0), u32((long) (top * f)), u32((long) (bottom * f)), u32((long) (left * f)),
                u32((long) (right * f)));
    }

    private static byte[] proj(byte[] child) {
        return box("proj", box("prhd", u32(0), u32(0), u32(0), u32(0)), child);
    }

    @Test
    public void vr180EquirectBounds() {
        FormatDetect.Spatial s = SpatialMeta.fromFormat(SpatialMeta.STEREO_LEFT_RIGHT, proj(equi(0, 0, 0.25, 0.25)));
        assertEquals("left-right", s.stereoMode);
        assertEquals("equirect", s.projection);
        assertArrayEquals(new double[] {0, 0, 0.25, 0.25}, s.equirectBounds, 1e-6);
        assertEquals("sbs180", FormatDetect.detect("x.mp4", 4096, 2048, s).layout);
    }

    @Test
    public void full360AndTopBottom() {
        FormatDetect.Spatial s = SpatialMeta.fromFormat(SpatialMeta.STEREO_TOP_BOTTOM, proj(equi(0, 0, 0, 0)));
        assertEquals("tb360", FormatDetect.detect("x_SBS.mp4", 4096, 4096, s).layout);
    }

    @Test
    public void wrappedInSv3d() {
        FormatDetect.Spatial s = SpatialMeta.fromFormat(SpatialMeta.STEREO_NONE,
                box("sv3d", box("svhd", u32(0)), proj(equi(0, 0, 0, 0))));
        assertNull(s.stereoMode);
        assertEquals("equirect", s.projection);
    }

    @Test
    public void meshAndCubemapAreNamedButNotEquirect() {
        assertEquals("mesh", SpatialMeta.fromFormat(SpatialMeta.STEREO_LEFT_RIGHT, proj(box("mshp", u32(0)))).projection);
        assertEquals("cubemap", SpatialMeta.fromFormat(SpatialMeta.STEREO_NONE, proj(box("cbmp", u32(0)))).projection);
    }

    @Test
    public void nothingKnownGivesNull() {
        assertNull(SpatialMeta.fromFormat(SpatialMeta.STEREO_NONE, null));
        assertNull(SpatialMeta.fromFormat(SpatialMeta.STEREO_MESH, new byte[] {1, 2, 3}));
        assertNull(SpatialMeta.fromFormat(SpatialMeta.STEREO_NONE, new byte[] {0, 0, 0, 99, 'x', 'x', 'x', 'x'}));
    }

    @Test
    public void stereoOnly() {
        FormatDetect.Spatial s = SpatialMeta.fromFormat(SpatialMeta.STEREO_MONO, null);
        assertEquals("mono", s.stereoMode);
        assertNull(s.projection);
    }
}
