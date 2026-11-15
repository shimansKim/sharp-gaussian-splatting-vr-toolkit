package com.sharp.questnative.ui;

import com.sharp.questnative.source.PcApi;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/** Small, Android-independent last-write-wins protocol. Never sends a trial table. */
final class BindingsSyncProtocol {
    static final int MIN_VERSION = 4;

    static final class Record {
        final Map<String, String> bindings;
        final long updatedAt;
        Record(Map<String, String> bindings, long updatedAt) {
            this.bindings = new LinkedHashMap<>(bindings);
            this.updatedAt = updatedAt;
        }
    }

    interface Transport {
        int version() throws IOException;
        String get() throws IOException;
        Reply put(String body) throws IOException;
    }

    static final class Reply {
        final int code;
        final String body;
        Reply(int code, String body) { this.code = code; this.body = body; }
    }

    /** Null means keep local. Both GET and 409 records go through the same safety checks. */
    static Record exchange(Transport transport, Record local) throws IOException {
        if (transport.version() < MIN_VERSION) return null;
        Record remote = parse(transport.get(), local.bindings, false);
        if (remote != null && remote.updatedAt > local.updatedAt) return remote;
        if (local.updatedAt == 0 || (remote != null && remote.updatedAt == local.updatedAt)) return null;
        try {
            JSONObject body = new JSONObject();
            body.put("schema", 2);
            body.put("bindings", new JSONObject(local.bindings));
            body.put("updatedAt", local.updatedAt);
            body.put("force", false);
            Reply reply = transport.put(body.toString());
            if (reply.code != 200 && reply.code != 409) throw new IOException("bindings HTTP " + reply.code);
            Record saved = parse(reply.body, local.bindings, reply.code == 409);
            return saved != null && saved.updatedAt > local.updatedAt ? saved : null;
        } catch (JSONException e) {
            throw new IOException("bad bindings response", e);
        }
    }

    static Record parse(String json, Map<String, String> local, boolean conflict) throws IOException {
        try {
            JSONObject root = new JSONObject(json);
            if (conflict) root = root.getJSONObject("current");
            if (root.optInt("schema", 0) != 2) return null;
            JSONObject raw = root.optJSONObject("bindings");
            long timestamp = root.optLong("updatedAt", 0);
            if (raw == null || raw.length() == 0 || timestamp <= 0) return null;
            Map<String, String> filtered = new LinkedHashMap<>(local);
            for (String slot : Bindings.SLOTS) {
                Object value = raw.opt(slot);
                if (value instanceof String && Bindings.ACTIONS.containsKey((String) value)) {
                    filtered.put(slot, (String) value);
                }
            }
            // Unknown slots/actions must never introduce an escape action that this app cannot run.
            if (!filtered.containsValue("ui.toggle")) throw new IOException("bindings have no UI toggle");
            return new Record(filtered, timestamp);
        } catch (JSONException e) {
            throw new IOException("bad bindings response", e);
        }
    }

    static Transport http(String base) {
        return new Transport() {
            public int version() throws IOException { return PcApi.fetchInfo(base, 3000, 5000).version; }
            public String get() throws IOException {
                Reply reply = request(base, null);
                if (reply.code != 200) throw new IOException("bindings HTTP " + reply.code);
                return reply.body;
            }
            public Reply put(String body) throws IOException { return request(base, body); }
        };
    }

    private static Reply request(String base, String body) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(base + "/api/bindings").openConnection();
        try {
            c.setConnectTimeout(3000);
            c.setReadTimeout(5000);
            c.setInstanceFollowRedirects(false);
            c.setUseCaches(false);
            if (body != null) {
                c.setRequestMethod("PUT");
                c.setRequestProperty("X-Sharp-App", "splatia");
                c.setRequestProperty("Content-Type", "application/json");
                c.setDoOutput(true);
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                c.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = c.getOutputStream()) { out.write(bytes); }
            }
            int code = c.getResponseCode();
            InputStream stream = code >= 400 ? c.getErrorStream() : c.getInputStream();
            if (stream == null) throw new IOException("empty bindings response");
            try (InputStream in = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                int n;
                while ((n = in.read(buffer)) != -1) {
                    if (out.size() + n > 65536) throw new IOException("bindings response too large");
                    out.write(buffer, 0, n);
                }
                return new Reply(code, new String(out.toByteArray(), StandardCharsets.UTF_8));
            }
        } finally {
            c.disconnect();
        }
    }
}
