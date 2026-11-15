package com.sharp.questnative.video;

import java.util.function.Consumer;
import java.util.function.Supplier;

/** Serializes worker publication, posting and shutdown across calling threads. */
final class VideoWorkerQueue<W extends VideoWorkerQueue.Worker> {
    interface Worker {
        boolean post(Runnable action);
        void shutdown();
    }

    private W worker;

    synchronized void init(Supplier<W> factory) {
        if (worker == null) worker = factory.get();
    }

    synchronized boolean post(Consumer<W> action) {
        W owner = worker;
        return owner != null && owner.post(() -> action.accept(owner));
    }

    synchronized void shutdown() {
        W owner = worker;
        if (owner == null) return;
        worker = null;
        owner.shutdown();
    }
}
