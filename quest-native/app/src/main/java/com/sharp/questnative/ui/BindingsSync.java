package com.sharp.questnative.ui;

import android.util.Log;
import com.sharp.questnative.core.MediaSource;
import com.sharp.questnative.core.SourceRegistry;
import com.sharp.questnative.source.PcSource;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Event-driven synchronization; network work never runs on the UI or render thread. */
public final class BindingsSync {
    private static final ExecutorService IO = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "QnBindingsSync");
        t.setDaemon(true);
        return t;
    });
    // Accessed only on QnUiDraw. Coalesce connection/resume/edit events into one trailing request.
    private static boolean busy;
    private static boolean pending;

    private BindingsSync() {}

    /** Called after a successful PC connection, app resume, or a confirmed local edit. */
    public static void request() { UiThread.post(BindingsSync::start); }

    private static String connectedBase() {
        MediaSource source = SourceRegistry.find(PcSource.ID);
        return source instanceof PcSource ? ((PcSource) source).connectedBase() : null;
    }

    private static void start() {
        Bindings bindings = PanelHost.bindings();
        if (!bindings.ready() || bindings.onTrial()) return; // keep/revert/initial attach requests again
        if (busy) { pending = true; return; }
        String base = connectedBase();
        if (base == null) return;
        BindingsSyncProtocol.Record local = bindings.snapshot();
        busy = true;
        IO.execute(() -> {
            BindingsSyncProtocol.Record received = null;
            try {
                received = BindingsSyncProtocol.exchange(BindingsSyncProtocol.http(base), local);
            } catch (Exception e) {
                // Offline, legacy/malformed server or unsafe mapping: retain the durable local table.
                Log.w("QuestNative", "[ui] PC bindings sync skipped: " + e.getMessage());
            }
            final BindingsSyncProtocol.Record result = received;
            UiThread.post(() -> {
                busy = false;
                if (base.equals(connectedBase()) && result != null) {
                    // A local trial/confirmed edit may have happened while HTTP was in flight.
                    if (!bindings.applySynced(local, result)) pending = true;
                }
                if (pending) {
                    pending = false;
                    start();
                }
            });
        });
    }
}
