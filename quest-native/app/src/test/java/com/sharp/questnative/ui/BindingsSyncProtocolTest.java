package com.sharp.questnative.ui;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.Locale;
import org.json.JSONObject;
import org.junit.Test;
import java.io.IOException;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

public class BindingsSyncProtocolTest {
    private static Map<String, String> defaults() {
        Map<String, String> map = new LinkedHashMap<>();
        for (String slot : Bindings.SLOTS) map.put(slot, Bindings.DEFAULTS.getOrDefault(slot, ""));
        return map;
    }

    private static String json(Map<String, String> map, long time) throws Exception {
        return new JSONObject().put("schema", 2).put("bindings", new JSONObject(map))
                .put("updatedAt", time).toString();
    }

    private static final class Fake implements BindingsSyncProtocol.Transport {
        int version = 4, gets, puts, code = 200;
        String remote, response, uploaded;
        Fake(String remote) { this.remote = remote; this.response = remote; }
        public int version() { return version; }
        public String get() { gets++; return remote; }
        public BindingsSyncProtocol.Reply put(String body) {
            puts++; uploaded = body;
            return new BindingsSyncProtocol.Reply(code, response);
        }
    }

    @Test public void newerRemoteWinsWithoutUpload() throws Exception {
        Map<String, String> remote = defaults(); remote.put("A.short", "nav.next");
        Fake t = new Fake(json(remote, 200));
        BindingsSyncProtocol.Record result = BindingsSyncProtocol.exchange(t,
                new BindingsSyncProtocol.Record(defaults(), 100));
        assertEquals("nav.next", result.bindings.get("A.short"));
        assertEquals(200, result.updatedAt);
        assertEquals(0, t.puts);
    }

    @Test public void newerLocalUploadsCompleteTableWithoutForce() throws Exception {
        Fake t = new Fake(json(defaults(), 100));
        assertNull(BindingsSyncProtocol.exchange(t, new BindingsSyncProtocol.Record(defaults(), 200)));
        JSONObject body = new JSONObject(t.uploaded);
        assertEquals(10, body.getJSONObject("bindings").length());
        assertEquals("", body.getJSONObject("bindings").getString("A.long"));
        assertEquals(200, body.getLong("updatedAt"));
        assertFalse(body.getBoolean("force"));
    }

    @Test public void equalTimestampDoesNotPingPong() throws Exception {
        Fake t = new Fake(json(defaults(), 100));
        assertNull(BindingsSyncProtocol.exchange(t, new BindingsSyncProtocol.Record(defaults(), 100)));
        assertEquals(0, t.puts);
    }

    @Test public void emptyRemotePreservesUntouchedLocal() throws Exception {
        Fake t = new Fake(json(new LinkedHashMap<>(), 0));
        assertNull(BindingsSyncProtocol.exchange(t, new BindingsSyncProtocol.Record(defaults(), 0)));
        assertEquals(0, t.puts);
    }

    @Test public void emptyRemoteGetsConfirmedLocal() throws Exception {
        Fake t = new Fake(json(new LinkedHashMap<>(), 0));
        BindingsSyncProtocol.exchange(t, new BindingsSyncProtocol.Record(defaults(), 100));
        assertEquals(1, t.puts);
    }

    @Test public void oldServerNeverReadsOrWritesBindings() throws Exception {
        Fake t = new Fake("not json"); t.version = 3;
        assertNull(BindingsSyncProtocol.exchange(t, new BindingsSyncProtocol.Record(defaults(), 100)));
        assertEquals(0, t.gets); assertEquals(0, t.puts);
    }

    @Test public void unknownSchemaNeverAppliesRemote() throws Exception {
        Fake t = new Fake("{\"schema\":99,\"updatedAt\":999,\"bindings\":{\"A.short\":\"nav.next\"}}");
        assertNull(BindingsSyncProtocol.exchange(t, new BindingsSyncProtocol.Record(defaults(), 0)));
        assertEquals(0, t.puts);
    }

    @Test public void unknownIdsAndNonStringsAreIgnoredAndEmptyClears() throws Exception {
        JSONObject raw = new JSONObject(defaults()).put("unknown.short", "ui.toggle")
                .put("A.short", "future.action").put("A.long", 123).put("X.short", "");
        String record = new JSONObject().put("schema", 2).put("updatedAt", 100).put("bindings", raw).toString();
        BindingsSyncProtocol.Record result = BindingsSyncProtocol.parse(record, defaults(), false);
        assertEquals(10, result.bindings.size());
        assertEquals("list.toggle", result.bindings.get("A.short"));
        assertEquals("", result.bindings.get("A.long"));
        assertEquals("", result.bindings.get("X.short"));
    }

    @Test public void noUiToggleIsRejectedEvenWhenUnknownSlotHasOne() throws Exception {
        Map<String, String> unsafe = defaults();
        unsafe.put("B.short", ""); unsafe.put("Y.short", ""); unsafe.put("future.short", "ui.toggle");
        Fake t = new Fake(json(unsafe, 200));
        assertThrows(IOException.class, () -> BindingsSyncProtocol.exchange(t,
                new BindingsSyncProtocol.Record(defaults(), 100)));
        assertEquals(0, t.puts);
    }

    @Test public void conflictUsesNewerCurrent() throws Exception {
        Fake t = new Fake(json(defaults(), 50)); t.code = 409;
        Map<String, String> current = defaults(); current.put("A.short", "nav.prev");
        t.response = new JSONObject().put("current", new JSONObject(json(current, 300))).toString();
        BindingsSyncProtocol.Record result = BindingsSyncProtocol.exchange(t,
                new BindingsSyncProtocol.Record(defaults(), 200));
        assertEquals(300, result.updatedAt);
        assertEquals("nav.prev", result.bindings.get("A.short"));
        assertEquals(1, t.puts);
    }

    @Test public void conflictCannotRemoveUiToggle() throws Exception {
        Fake t = new Fake(json(defaults(), 50)); t.code = 409;
        Map<String, String> current = defaults(); current.put("B.short", ""); current.put("Y.short", "");
        t.response = new JSONObject().put("current", new JSONObject(json(current, 300))).toString();
        assertThrows(IOException.class, () -> BindingsSyncProtocol.exchange(t,
                new BindingsSyncProtocol.Record(defaults(), 200)));
    }

    @Test public void serverFailureLeavesLocalSnapshotUnchanged() throws Exception {
        Fake t = new Fake(json(defaults(), 50)); t.code = 500;
        BindingsSyncProtocol.Record local = new BindingsSyncProtocol.Record(defaults(), 200);
        assertThrows(IOException.class, () -> BindingsSyncProtocol.exchange(t, local));
        assertEquals(defaults(), local.bindings); assertEquals(200, local.updatedAt);
    }

    @Test public void httpSendsNativeHeaderAndConsumes409Body() throws Exception {
        ServerSocket server = new ServerSocket(0, 3, InetAddress.getByName("127.0.0.1"));
        server.setSoTimeout(10000);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        AtomicReference<String> header = new AtomicReference<>();
        AtomicReference<String> origin = new AtomicReference<>();
        AtomicReference<String> contentType = new AtomicReference<>();
        AtomicReference<String> payload = new AtomicReference<>();
        String current = new JSONObject().put("current", new JSONObject(json(defaults(), 300))).toString();
        String empty = json(new LinkedHashMap<>(), 0);
        Thread responder = new Thread(() -> {
            try {
                for (int request = 0; request < 3; request++) {
                    try (Socket socket = server.accept()) {
                        socket.setSoTimeout(10000);
                        BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                        String line = in.readLine();
                        boolean put = line.startsWith("PUT ");
                        boolean info = line.contains("/api/info ");
                        Map<String, String> headers = new LinkedHashMap<>();
                        while ((line = in.readLine()) != null && !line.isEmpty()) {
                            int colon = line.indexOf(':');
                            headers.put(line.substring(0, colon).toLowerCase(Locale.ROOT), line.substring(colon + 1).trim());
                        }
                        if (put) {
                            header.set(headers.get("x-sharp-app")); origin.set(headers.get("origin"));
                            contentType.set(headers.get("content-type"));
                            int length = Integer.parseInt(headers.get("content-length"));
                            char[] chars = new char[length];
                            int offset = 0, count;
                            while (offset < length && (count = in.read(chars, offset, length - offset)) != -1) offset += count;
                            payload.set(new String(chars, 0, offset));
                        }
                        String body = info ? "{\"app\":\"sharp-quest-server\",\"version\":4}" : put ? current : empty;
                        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                        String response = "HTTP/1.1 " + (put ? "409 Conflict" : "200 OK")
                                + "\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n";
                        socket.getOutputStream().write(response.getBytes(StandardCharsets.US_ASCII));
                        socket.getOutputStream().write(bytes);
                    }
                }
            } catch (Throwable e) { failure.set(e); }
        }, "BindingsTestHttp");
        responder.setDaemon(true);
        responder.start();
        try {
            BindingsSyncProtocol.Record result = BindingsSyncProtocol.exchange(BindingsSyncProtocol.http(
                    "http://127.0.0.1:" + server.getLocalPort()),
                    new BindingsSyncProtocol.Record(defaults(), 200));
            assertEquals(300, result.updatedAt);
            assertEquals("splatia", header.get()); assertNull(origin.get());
            assertEquals("application/json", contentType.get());
            assertEquals(10, new JSONObject(payload.get()).getJSONObject("bindings").length());
        } finally {
            server.close();
            responder.join(1000);
        }
        assertNull(failure.get());
    }
}
