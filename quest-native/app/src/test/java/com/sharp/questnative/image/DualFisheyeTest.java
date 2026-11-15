package com.sharp.questnative.image;

import org.junit.Test;
import static org.junit.Assert.*;

public class DualFisheyeTest {
    @Test public void centresAndSeam() {
        DualFisheye.Calibration c = DualFisheye.defaults(2000, 1000);
        double[] xy = new double[5];
        DualFisheye.map(.5, .5, c, xy);
        assertEquals(500, xy[0], 1e-6); assertEquals(500, xy[1], 1e-6); assertEquals(1, xy[4], 1e-6);
        DualFisheye.map(0, .5, c, xy);
        assertEquals(1500, xy[2], 1e-6); assertEquals(500, xy[3], 1e-6); assertEquals(0, xy[4], 1e-6);
        DualFisheye.map(.75, .5, c, xy);
        assertEquals(.5, xy[4], 1e-6);
        assertTrue(Double.isFinite(xy[0]));
    }
    @Test public void bilinearSamplesAndClamps() {
        int[] pixels = {0xff000000, 0xffff0000, 0xff00ff00, 0xff0000ff};
        assertEquals(0xff404040, DualFisheye.sample(pixels, 2, 2, .5, .5));
        assertEquals(0xffff0000, DualFisheye.sample(pixels, 2, 2, 9, -3));
        assertEquals(0xff0000ff, DualFisheye.sample(pixels, 2, 2, 1, 1));
    }
    @Test public void metadataValidation() {
        String text = "2_490_500_501_0_0_0_491_1500_499_0_0_-179_2000_1000";
        DualFisheye.Calibration c = DualFisheye.calibration(text, 1000, 500);
        assertNotNull(c); assertFalse(c.estimated);
        assertNotNull(DualFisheye.calibration(text + "_2323", 1000, 500));
        assertNull(DualFisheye.calibration(text + "_1234", 1000, 500));
        assertEquals(250, c.cx[0], 1e-6); assertEquals(750, c.cx[1], 1e-6);
        assertNull(DualFisheye.calibration("3_bad", 1000, 500));
        assertTrue(DualFisheye.calibration(null, 1000, 500).estimated);
    }
}
