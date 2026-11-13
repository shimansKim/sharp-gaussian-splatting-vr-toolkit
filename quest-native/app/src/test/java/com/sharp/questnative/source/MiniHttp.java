package com.sharp.questnative.source;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Tiny HTTP/1.0 server for JVM tests (the Android unit-test classpath has no com.sun.net.httpserver).
 * Each path maps to a response: status, declared Content-Length and the bytes actually sent.
 */
final class MiniHttp implements AutoCloseable {
    static final class Reply {
        final int status;
        final long declaredLength;
        final byte[] body;

        Reply(int status, long declaredLength, byte[] body) {
            this.status = status;
            this.declaredLength = declaredLength;
            this.body = body;
        }
    }

    final Map<String, Reply> routes = new ConcurrentHashMap<>();
    final AtomicInteger hits = new AtomicInteger();
    private final ServerSocket socket;
    private final Thread thread;

    MiniHttp() throws IOException {
        socket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        thread = new Thread(this::serve, "MiniHttp");
        thread.setDaemon(true);
        thread.start();
    }

    String base() {
        return "http://127.0.0.1:" + socket.getLocalPort();
    }

    private void serve() {
        while (!socket.isClosed()) {
            try (Socket s = socket.accept()) {
                BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.ISO_8859_1));
                String line = in.readLine();
                if (line == null) continue;
                String path = line.split(" ")[1];
                while ((line = in.readLine()) != null && !line.isEmpty()) {
                    // skip headers
                }
                Reply r = routes.get(path);
                if (r == null) r = new Reply(404, 0, new byte[0]);
                hits.incrementAndGet();
                OutputStream out = s.getOutputStream();
                String head = "HTTP/1.0 " + r.status + " X\r\nContent-Length: " + r.declaredLength
                        + "\r\nConnection: close\r\n\r\n";
                out.write(head.getBytes(StandardCharsets.ISO_8859_1));
                out.write(r.body);
                out.flush();
            } catch (IOException ignored) {
                // closed or client gone
            }
        }
    }

    @Override
    public void close() throws IOException {
        socket.close();
    }
}
