package com.sharp.questnative.source;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.ParcelFileDescriptor;
import android.util.Log;

import com.sharp.questnative.core.MediaEntry;
import com.sharp.questnative.core.MediaKind;
import com.sharp.questnative.core.MediaSource;
import com.sharp.questnative.core.QnActivity;
import com.sharp.questnative.ui.hud.Hud;

import java.io.File;
import java.io.IOException;
import java.net.InetAddress;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Files on the PC through the SHARP PC server (scripts/quest_media_server.py, run_quest_pc_server.bat).
 * <ul>
 *   <li>Finding the PC: last working address → the address typed in the setup screen → mDNS
 *       "_sharpvr._tcp" (Android NsdManager) → sweep of this headset's Wi-Fi /24 on port 8787.</li>
 *   <li>Folders: /api/info roots, then /api/list pages. Ids are "rootId|relative/path".</li>
 *   <li>Opening: videos stream over HTTP (openFd returns -1, the video viewer plays entry.uri with
 *       Media3). Photos and PLY are downloaded to the app cache first ({@link PcCache}) and opened
 *       from a file descriptor, because those viewers read files, not URLs.</li>
 * </ul>
 * Only private-network addresses are used ({@link PcApi#normalizeBase}). Owner: encode-guide.
 */
public final class PcSource implements MediaSource {
    public static final String ID = "pc";
    private static final String TAG = "QuestNative";
    private static final String PREFS = "pc_source";
    private static final String KEY_LAST = "last";
    private static final String KEY_MANUAL = "manual";
    private static final String NSD_TYPE = "_sharpvr._tcp.";

    private final Context context;
    private final PcCache cache;

    private final Object lock = new Object();
    private String base;            // connected server, null when not connected
    private PcApi.Info info;        // its /api/info
    private String status = "PC를 아직 찾지 않았어요";

    public PcSource(Context context) {
        this.context = context.getApplicationContext();
        File dir = new File(this.context.getCacheDir(), "pc");
        this.cache = new PcCache(dir, PcCache.defaultLimit(this.context.getCacheDir().getUsableSpace()));
    }

    @Override
    public String id() {
        return ID;
    }

    @Override
    public String displayName() {
        return "PC";
    }

    // ---------------------------------------------------------------- connection

    /** One line for the list card / setup screen: connected PC or why it is not connected. */
    public String statusText() {
        synchronized (lock) {
            return status;
        }
    }

    /** Connected base ("http://192.168.0.23:8787") or null. */
    public String connectedBase() {
        synchronized (lock) {
            return base;
        }
    }

    public String manualAddress() {
        return prefs().getString(KEY_MANUAL, "");
    }

    /**
     * Saves the typed address (empty clears it) and connects to it right away.
     * Returns null on success, else a Korean message for the user. Worker thread only.
     */
    public String setManualAddress(String text) {
        String t = text == null ? "" : text.trim();
        if (t.isEmpty()) {
            prefs().edit().remove(KEY_MANUAL).apply();
            return null;
        }
        String b = PcApi.normalizeBase(t);
        if (b == null) return "집 안 네트워크 주소만 쓸 수 있어요(예: 192.168.0.23 또는 192.168.0.23:8787)";
        prefs().edit().putString(KEY_MANUAL, b).apply();
        try {
            PcApi.Info i = PcApi.fetchInfo(b, 3000, 5000);
            connected(b, i);
            return null;
        } catch (IOException e) {
            Log.w(TAG, "[source] pc manual address failed " + b, e);
            return failText(b, e);
        }
    }

    /** Forgets the current connection and searches again. Worker thread only. */
    public String reconnect() {
        synchronized (lock) {
            base = null;
            info = null;
        }
        try {
            ensureConnected();
            return null;
        } catch (IOException e) {
            return statusText();
        }
    }

    private PcApi.Info ensureConnected() throws IOException {
        synchronized (lock) {
            if (base != null && info != null) return info;
        }
        setStatus("PC를 찾는 중…");
        List<String> remembered = new ArrayList<>();
        SharedPreferences p = prefs();
        String last = p.getString(KEY_LAST, null);
        String manual = p.getString(KEY_MANUAL, null);
        if (last != null) remembered.add(last);
        if (manual != null && !manual.equals(last)) remembered.add(manual);

        // 1) remembered addresses, one by one.
        String found = PcDiscovery.find(remembered, remembered.size(), 1, 0, PcDiscovery.HTTP);
        // 2) mDNS name advertised by the server.
        if (found == null) found = resolveNsd(2500);
        // 3) sweep of our own Wi-Fi /24.
        if (found == null) {
            List<String> ips = PcDiscovery.localIpv4();
            if (ips.isEmpty()) {
                setStatus("Wi-Fi에 연결되어 있지 않아요. 헤드셋의 Wi-Fi를 켜세요");
                throw new IOException("no Wi-Fi address");
            }
            List<String> sweep = PcDiscovery.candidates(new ArrayList<>(), ips, PcApi.DEFAULT_PORT);
            Log.i(TAG, "[source] pc sweep " + sweep.size() + " addresses near " + ips);
            found = PcDiscovery.find(sweep, 0, 48, 15000, PcDiscovery.HTTP);
        }
        if (found == null) {
            setStatus("PC를 찾지 못했어요. PC에서 run_quest_pc_server.bat을 켜고, 헤드셋과 같은 Wi-Fi인지 확인하세요");
            throw new IOException("pc server not found");
        }
        PcApi.Info i;
        try {
            i = PcApi.fetchInfo(found, 3000, 5000);
        } catch (IOException e) {
            setStatus(failText(found, e));
            throw e;
        }
        connected(found, i);
        return i;
    }

    private void connected(String b, PcApi.Info i) {
        String text;
        if (i.version < PcApi.MIN_VERSION) {
            text = "PC 서버가 옛 버전이에요. PC에서 update_quest_pc_server.bat을 실행하세요";
        } else if (i.roots.isEmpty()) {
            text = "PC에 공유 폴더가 없어요. run_quest_pc_server.bat에 폴더를 끌어다 놓으세요";
        } else {
            text = "연결됨: " + (i.host.isEmpty() ? b : i.host) + " (" + b.substring(7) + ")";
        }
        synchronized (lock) {
            base = b;
            info = i;
            status = text;
        }
        prefs().edit().putString(KEY_LAST, b).apply();
        Log.i(TAG, "[source] pc connected " + b + " v" + i.version + " roots=" + i.roots.size());
    }

    private static String failText(String b, IOException e) {
        if (e instanceof PcApi.HttpError && ((PcApi.HttpError) e).code == 403) {
            return "PC 서버가 접속을 막았어요(" + b.substring(7) + "). 주소를 IP로 입력해 보세요";
        }
        if (e.getMessage() != null && e.getMessage().contains("not a SHARP")) {
            return b.substring(7) + "는 SHARP PC 서버가 아니에요";
        }
        return b.substring(7) + "에 연결하지 못했어요. PC 서버가 켜져 있는지, 방화벽이 8787 포트를 막지 않는지 확인하세요";
    }

    private void setStatus(String s) {
        synchronized (lock) {
            status = s;
        }
    }

    /** First "_sharpvr._tcp" service on the network as "http://ip:port", or null within timeoutMs. */
    private String resolveNsd(long timeoutMs) {
        NsdManager nsd = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
        if (nsd == null) return null;
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
            private boolean resolving;

            @Override
            public void onServiceFound(NsdServiceInfo service) {
                synchronized (this) {
                    if (resolving) return;
                    resolving = true;
                }
                nsd.resolveService(service, new NsdManager.ResolveListener() {
                    @Override
                    public void onServiceResolved(NsdServiceInfo s) {
                        InetAddress host = s.getHost();
                        if (host != null) {
                            String b = PcApi.normalizeBase(host.getHostAddress() + ":" + s.getPort());
                            if (b != null) result.compareAndSet(null, b);
                        }
                        done.countDown();
                    }

                    @Override
                    public void onResolveFailed(NsdServiceInfo s, int errorCode) {
                        done.countDown();
                    }
                });
            }

            @Override public void onDiscoveryStarted(String serviceType) {}
            @Override public void onServiceLost(NsdServiceInfo service) {}
            @Override public void onDiscoveryStopped(String serviceType) {}

            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                done.countDown();
            }

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {}
        };
        boolean started = false;
        try {
            nsd.discoverServices(NSD_TYPE, NsdManager.PROTOCOL_DNS_SD, listener);
            started = true;
            done.await(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (RuntimeException e) {
            Log.w(TAG, "[source] pc mDNS discovery failed", e);
        } finally {
            if (started) {
                try {
                    nsd.stopServiceDiscovery(listener);
                } catch (RuntimeException ignored) {
                    // already stopped
                }
            }
        }
        String b = result.get();
        if (b == null) return null;
        try {
            PcDiscovery.HTTP.probe(b);
            return b;
        } catch (IOException e) {
            return null;
        }
    }

    // ---------------------------------------------------------------- MediaSource

    @Override
    public List<MediaEntry> list(String folderId) throws IOException {
        PcApi.Info i;
        try {
            i = ensureConnected();
        } catch (IOException e) {
            Hud.toast(statusText(), 6);
            throw e;
        }
        String b = connectedBase();
        if (folderId == null) {
            if (i.version < PcApi.MIN_VERSION || i.roots.isEmpty()) Hud.toast(statusText(), 6);
            List<MediaEntry> out = new ArrayList<>();
            for (PcApi.Root r : i.roots) {
                out.add(new MediaEntry(PcApi.folderId(r.id, ""), r.label, true, null, -1, 0, null));
            }
            return out;
        }
        String[] rp = PcApi.splitId(folderId);
        try {
            return PcApi.fetchFolder(b, rp[0], rp[1]);
        } catch (PcApi.HttpError e) {
            throw e; // the server answered (folder gone, outside root): keep the connection
        } catch (IOException e) {
            // Connection lost (PC asleep, address changed): search again once.
            Log.w(TAG, "[source] pc list failed, searching again", e);
            synchronized (lock) {
                base = null;
                info = null;
            }
            ensureConnected();
            return PcApi.fetchFolder(connectedBase(), rp[0], rp[1]);
        }
    }

    @Override
    public int openFd(MediaEntry entry) throws IOException {
        if (entry.uri == null) return -1;
        String kind = MediaKind.of(entry.name, entry.mimeType);
        if (MediaKind.VIDEO.equals(kind)) return -1; // Media3 streams the http URL (Range requests)
        if (PcApi.normalizeBase(baseOf(entry.uri)) == null) throw new IOException("not a local address " + entry.uri);
        final long[] lastToast = {0};
        File f;
        try {
            f = cache.fetch(entry.uri, entry.size, entry.modifiedMs, entry.name, (done, total) -> {
                long now = System.currentTimeMillis();
                if (now - lastToast[0] < 1000) return;
                lastToast[0] = now;
                String pct = total > 0 ? (done * 100 / total) + "%" : (done >> 20) + " MB";
                Hud.toast("PC에서 내려받는 중 " + pct, 1.5f);
            });
        } catch (IOException e) {
            Hud.toast("PC에서 파일을 받지 못했어요: " + entry.name, 4);
            throw e;
        }
        ParcelFileDescriptor pfd = ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
        return pfd.detachFd();
    }

    /** "http://h:p" part of a file URL. */
    static String baseOf(String url) {
        if (url == null || !url.startsWith("http://")) return null;
        int slash = url.indexOf('/', 7);
        return (slash < 0 ? url : url.substring(0, slash)).toLowerCase(Locale.ROOT);
    }

    /**
     * Opens the 2D setup screen (address, search, cache). done runs when it closes. For the list
     * card's [연결 설정] button once the source setup hook is in the contract.
     */
    public boolean openSetupScreen(Runnable done) {
        QnActivity a = QnActivity.current();
        if (a == null) return false;
        a.startForResult(new Intent(a, PcSetupActivity.class), (code, data) -> {
            if (done != null) done.run();
        });
        return true;
    }

    public PcCache cache() {
        return cache;
    }

    private SharedPreferences prefs() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
