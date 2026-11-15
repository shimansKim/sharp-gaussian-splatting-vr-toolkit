package com.sharp.questnative.video;

import static org.junit.Assert.*;

import java.util.ArrayDeque;
import java.util.Queue;
import org.junit.Test;

public class VideoWorkerQueueTest {
    private static final class FakeWorker implements VideoWorkerQueue.Worker {
        final Queue<Runnable> tasks = new ArrayDeque<>();
        boolean accepting = true;
        boolean live;
        int releases;
        int shutdowns;
        int polls;

        @Override public boolean post(Runnable action) {
            if (!accepting) return false;
            tasks.add(action);
            return true;
        }

        @Override public void shutdown() {
            shutdowns++;
            tasks.add(() -> {
                if (live) {
                    releases++;
                    live = false;
                }
                accepting = false;
            });
        }

        void drain() {
            while (!tasks.isEmpty()) tasks.remove().run();
        }
    }

    @Test public void queuedOpenIsReleasedAfterShutdown() {
        VideoWorkerQueue<FakeWorker> queue = new VideoWorkerQueue<>();
        FakeWorker worker = new FakeWorker();
        queue.init(() -> worker);
        assertTrue(queue.post(w -> w.live = true));
        queue.shutdown();
        assertFalse(queue.post(w -> fail("post after shutdown")));
        assertEquals(0, worker.releases);
        worker.drain();
        assertEquals(1, worker.releases);
        assertFalse(worker.live);
        assertFalse(worker.accepting);
    }

    @Test public void liveSessionIsReleasedOnceOnDrainAndShutdownIsIdempotent() {
        VideoWorkerQueue<FakeWorker> queue = new VideoWorkerQueue<>();
        FakeWorker worker = new FakeWorker();
        queue.init(() -> worker);
        assertTrue(queue.post(w -> w.live = true));
        worker.drain();
        queue.shutdown();
        queue.shutdown();
        assertTrue(worker.live);
        assertEquals(1, worker.shutdowns);
        worker.drain();
        assertEquals(1, worker.releases);
        assertFalse(worker.live);
    }

    @Test public void queuedPollRunsOnOldOwnerBeforeCleanup() {
        VideoWorkerQueue<FakeWorker> queue = new VideoWorkerQueue<>();
        FakeWorker worker = new FakeWorker();
        queue.init(() -> worker);
        assertTrue(queue.post(w -> w.live = true));
        assertTrue(queue.post(w -> { assertTrue(w.live); w.polls++; }));
        queue.shutdown();
        worker.drain();
        assertEquals(1, worker.polls);
        assertEquals(1, worker.releases);
    }

    @Test public void reinitializationKeepsOldCleanupAwayFromNewSession() {
        VideoWorkerQueue<FakeWorker> queue = new VideoWorkerQueue<>();
        FakeWorker oldWorker = new FakeWorker();
        FakeWorker newWorker = new FakeWorker();
        queue.init(() -> oldWorker);
        assertTrue(queue.post(w -> w.live = true));
        queue.shutdown();
        queue.init(() -> newWorker);
        assertTrue(queue.post(w -> w.live = true));
        newWorker.drain();
        oldWorker.drain();
        assertEquals(1, oldWorker.releases);
        assertTrue(newWorker.live);
        assertEquals(0, newWorker.releases);
        queue.shutdown();
        newWorker.drain();
        assertEquals(1, newWorker.releases);
    }

    @Test public void rejectsClosedAndWorkerRejectedPostsWithoutRunningAction() {
        VideoWorkerQueue<FakeWorker> queue = new VideoWorkerQueue<>();
        assertFalse(queue.post(w -> fail("no worker")));
        FakeWorker worker = new FakeWorker();
        queue.init(() -> worker);
        worker.accepting = false;
        assertFalse(queue.post(w -> fail("rejected")));
        worker.drain();
        queue.shutdown();
        assertFalse(queue.post(w -> fail("closed")));
    }

    @Test public void initDoesNotReplaceAnActiveWorker() {
        VideoWorkerQueue<FakeWorker> queue = new VideoWorkerQueue<>();
        FakeWorker worker = new FakeWorker();
        queue.init(() -> worker);
        queue.init(() -> { fail("factory called twice"); return new FakeWorker(); });
        assertTrue(queue.post(w -> w.live = true));
        worker.drain();
        assertTrue(worker.live);
    }
}
