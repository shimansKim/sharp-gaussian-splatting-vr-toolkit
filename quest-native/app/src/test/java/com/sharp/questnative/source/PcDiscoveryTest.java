package com.sharp.questnative.source;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.Test;

/** Candidate order and the parallel sweep, with a fake prober. */
public class PcDiscoveryTest {
    @Test
    public void rememberedFirstThenSweepWithoutDuplicates() {
        List<String> c = PcDiscovery.candidates(Arrays.asList("192.168.0.9", "8.8.8.8", "http://192.168.0.9:8787"),
                Collections.singletonList("192.168.0.57"), 8787);
        assertEquals("http://192.168.0.9:8787", c.get(0));
        assertEquals("http://192.168.0.1:8787", c.get(1));
        assertEquals(1 + 253 - 1, c.size()); // .9 appears once
    }

    @Test
    public void rememberedAddressWinsOverSweep() {
        List<String> bases = Arrays.asList("http://192.168.0.9:8787", "http://192.168.0.1:8787", "http://192.168.0.2:8787");
        String found = PcDiscovery.find(bases, 1, 8, 2000, b -> {
            if (!b.contains(".9:") && !b.contains(".2:")) throw new IOException("no");
        });
        assertEquals("http://192.168.0.9:8787", found);
    }

    @Test
    public void sweepFindsTheOneServer() {
        List<String> bases = PcApi.subnetBases("192.168.0.57", 8787);
        AtomicInteger probes = new AtomicInteger();
        String found = PcDiscovery.find(bases, 0, 48, 5000, b -> {
            probes.incrementAndGet();
            try {
                Thread.sleep(5);
            } catch (InterruptedException e) {
                throw new IOException(e);
            }
            if (!b.equals("http://192.168.0.200:8787")) throw new IOException("no");
        });
        assertEquals("http://192.168.0.200:8787", found);
        assertTrue(probes.get() <= bases.size());
    }

    @Test
    public void nothingFound() {
        List<String> bases = new ArrayList<>(PcApi.subnetBases("10.0.0.5", 8787));
        assertNull(PcDiscovery.find(bases, 0, 32, 3000, b -> {
            throw new IOException("no");
        }));
        assertNull(PcDiscovery.find(Collections.emptyList(), 0, 4, 100, b -> {}));
    }

    @Test
    public void budgetStopsASlowSweep() {
        long t0 = System.currentTimeMillis();
        assertNull(PcDiscovery.find(PcApi.subnetBases("10.0.0.5", 8787), 0, 4, 300, b -> {
            try {
                Thread.sleep(200);
            } catch (InterruptedException e) {
                throw new IOException(e);
            }
            throw new IOException("no");
        }));
        assertTrue(System.currentTimeMillis() - t0 < 2000);
    }
}
