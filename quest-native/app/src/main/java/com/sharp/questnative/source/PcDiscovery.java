package com.sharp.questnative.source;

import java.io.IOException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Finds the PC server without typing an address: the remembered addresses first, then every host
 * of this headset's own Wi-Fi /24 on port 8787. (mDNS "_sharpvr._tcp" is tried by PcSource with
 * Android NsdManager before the sweep.) A native app is not limited by the browser socket pool the
 * web app had to budget for, so the sweep runs 48 probes at a time with a short connect timeout.
 * Plain Java so it runs in JVM tests. Owner: encode-guide.
 */
public final class PcDiscovery {
    public interface Prober {
        /** Returns normally when base answers as the SHARP PC server. */
        void probe(String base) throws IOException;
    }

    /** Real prober: GET /api/info with short timeouts. */
    public static final Prober HTTP = base -> PcApi.fetchInfo(base, 600, 1500);

    private PcDiscovery() {}

    /** Site-local IPv4 addresses of this device (Wi-Fi first when the name says so). */
    public static List<String> localIpv4() {
        List<String> wifi = new ArrayList<>();
        List<String> other = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (!(a instanceof Inet4Address) || !a.isSiteLocalAddress()) continue;
                    String ip = a.getHostAddress();
                    if (ni.getName().startsWith("wlan")) wifi.add(ip);
                    else other.add(ip);
                }
            }
        } catch (SocketException ignored) {
            // no interfaces readable: the sweep has nothing to scan
        }
        wifi.addAll(other);
        return wifi;
    }

    /** Remembered bases first (in order), then the /24 sweep of each local address. No duplicates. */
    public static List<String> candidates(List<String> remembered, List<String> localIps, int port) {
        Set<String> out = new LinkedHashSet<>();
        for (String b : remembered) {
            String n = PcApi.normalizeBase(b);
            if (n != null) out.add(n);
        }
        for (String ip : localIps) out.addAll(PcApi.subnetBases(ip, port));
        return new ArrayList<>(out);
    }

    /**
     * Probes the bases with threads workers; returns the first that answers, or null. The first
     * fixedOrder bases are tried one by one before the sweep (a remembered address wins over a
     * different PC that happens to answer first).
     */
    public static String find(List<String> bases, int fixedOrder, int threads, long budgetMs, Prober prober) {
        int head = Math.min(fixedOrder, bases.size());
        for (int i = 0; i < head; i++) {
            try {
                prober.probe(bases.get(i));
                return bases.get(i);
            } catch (IOException | RuntimeException ignored) {
                // not there: next
            }
        }
        List<String> rest = bases.subList(head, bases.size());
        if (rest.isEmpty()) return null;
        AtomicReference<String> found = new AtomicReference<>();
        ExecutorService pool = Executors.newFixedThreadPool(Math.max(1, threads), r -> {
            Thread t = new Thread(r, "QnPcScan");
            t.setDaemon(true);
            return t;
        });
        try {
            for (String base : rest) {
                pool.execute(() -> {
                    if (found.get() != null) return;
                    try {
                        prober.probe(base);
                        found.compareAndSet(null, base);
                    } catch (IOException | RuntimeException ignored) {
                        // no server here
                    }
                });
            }
            pool.shutdown();
            long end = System.currentTimeMillis() + budgetMs;
            while (found.get() == null && System.currentTimeMillis() < end) {
                if (pool.awaitTermination(50, TimeUnit.MILLISECONDS)) break;
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            pool.shutdownNow();
        }
        return found.get();
    }
}
