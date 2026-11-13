package com.sharp.questnative.source;

import com.sharp.questnative.core.MediaEntry;
import com.sharp.questnative.core.MediaKind;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The PC media server's HTTP API (scripts/quest_media_server.py): address rules, URL building,
 * JSON parsing and a small GET helper. Plain Java (no Android classes) so it runs in JVM tests.
 * Owner: encode-guide.
 */
public final class PcApi {
    public static final int DEFAULT_PORT = 8787;
    /** Server app id in /api/info. */
    public static final String APP_ID = "sharp-quest-server";
    /** /api/list paging (total, nextOffset) arrived in API version 2. */
    public static final int MIN_VERSION = 2;
    /** Server page size cap (MAX_LIST) and our safety cap for one folder. */
    static final int PAGE = 5000;
    static final int MAX_ITEMS = 100_000;
    /** Folder/file ids are "rootId|relative/path"; "rootId|" is the root folder. */
    static final char SEP = '|';

    private static final Pattern IPV4 = Pattern.compile("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$");
    private static final Pattern HOSTNAME = Pattern.compile("^[a-z0-9]([a-z0-9-]{0,62})(\\.[a-z0-9]([a-z0-9-]{0,62}))*$");

    private PcApi() {}

    // ---------------------------------------------------------------- addresses

    /**
     * Turns what the user typed ("192.168.0.23", "192.168.0.23:8787", "http://pc-name.local:8787/")
     * into "http://host:port", or null when it is not a PC on the local network. Only http, only
     * private IPv4 (10/8, 172.16/12, 192.168/16), loopback, "*.local" and single-label PC names: the
     * app allows cleartext HTTP, so this is where it stays limited to the home network.
     */
    public static String normalizeBase(String text) {
        if (text == null) return null;
        String t = text.trim().toLowerCase(Locale.ROOT);
        if (t.isEmpty()) return null;
        if (t.startsWith("https://")) return null;
        if (t.startsWith("http://")) t = t.substring(7);
        while (t.endsWith("/")) t = t.substring(0, t.length() - 1);
        if (t.isEmpty() || t.contains("/") || t.contains("@") || t.contains("?") || t.contains("#")) return null;
        String host = t;
        int port = DEFAULT_PORT;
        int colon = t.lastIndexOf(':');
        if (colon >= 0) {
            host = t.substring(0, colon);
            String p = t.substring(colon + 1);
            if (p.isEmpty() || p.length() > 5 || !p.chars().allMatch(Character::isDigit)) return null;
            port = Integer.parseInt(p);
            if (port < 1 || port > 65535) return null;
        }
        if (!isLocalHost(host)) return null;
        return "http://" + host + ":" + port;
    }

    /** Private/loopback IPv4, "*.local", or a single-label host name (Windows PC name). */
    public static boolean isLocalHost(String host) {
        if (host == null || host.isEmpty()) return false;
        String h = host.toLowerCase(Locale.ROOT);
        Matcher m = IPV4.matcher(h);
        if (m.matches()) {
            int[] b = new int[4];
            for (int i = 0; i < 4; i++) {
                b[i] = Integer.parseInt(m.group(i + 1));
                if (b[i] > 255) return false;
            }
            return b[0] == 10 || b[0] == 127 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)
                    || (b[0] == 192 && b[1] == 168);
        }
        if (h.chars().allMatch(c -> Character.isDigit(c) || c == '.')) return false; // malformed IP
        if (!HOSTNAME.matcher(h).matches()) return false;
        return h.endsWith(".local") || h.equals("localhost") || !h.contains(".");
    }

    /** "192.168.0" for "http://192.168.0.23:8787", else null. */
    public static String ipv4Prefix(String base) {
        if (base == null || !base.startsWith("http://")) return null;
        String hostPort = base.substring(7);
        int colon = hostPort.indexOf(':');
        String host = colon < 0 ? hostPort : hostPort.substring(0, colon);
        if (!IPV4.matcher(host).matches() || !isLocalHost(host)) return null;
        return host.substring(0, host.lastIndexOf('.'));
    }

    /** The other 253 hosts of a /24 next to ownIp, nearest first (DHCP hands out low numbers). */
    public static List<String> subnetBases(String ownIp, int port) {
        List<String> out = new ArrayList<>();
        Matcher m = ownIp == null ? null : IPV4.matcher(ownIp);
        if (m == null || !m.matches() || !isLocalHost(ownIp) || ownIp.startsWith("127.")) return out;
        String prefix = ownIp.substring(0, ownIp.lastIndexOf('.'));
        int own = Integer.parseInt(m.group(4));
        List<Integer> hosts = new ArrayList<>();
        for (int i = 1; i <= 254; i++) if (i != own) hosts.add(i);
        // Low addresses first (routers give PCs .2-.50 most of the time), then the rest.
        Collections.sort(hosts, (a, b) -> Integer.compare(rank(a), rank(b)));
        for (int h : hosts) out.add("http://" + prefix + "." + h + ":" + port);
        return out;
    }

    private static int rank(int host) {
        return host <= 100 ? host : 1000 + host;
    }

    // ---------------------------------------------------------------- URLs

    static String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8").replace("+", "%20");
        } catch (java.io.UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
    }

    public static String infoUrl(String base) {
        return base + "/api/info";
    }

    public static String listUrl(String base, String root, String path, int offset, int limit) {
        return base + "/api/list?root=" + enc(root) + "&path=" + enc(path) + "&offset=" + offset + "&limit=" + limit;
    }

    /** "/files/<root>/<path segments>", each part percent-encoded (the server unquotes the whole tail). */
    public static String fileUrl(String base, String root, String path) {
        StringBuilder sb = new StringBuilder(base).append("/files/").append(enc(root));
        for (String part : path.split("/")) {
            if (part.isEmpty()) continue;
            sb.append('/').append(enc(part));
        }
        return sb.toString();
    }

    static String folderId(String root, String path) {
        return root + SEP + path;
    }

    /** {root, path} from a folder/file id. */
    static String[] splitId(String id) throws IOException {
        int bar = id == null ? -1 : id.indexOf(SEP);
        if (bar <= 0) throw new IOException("bad pc id " + id);
        return new String[] {id.substring(0, bar), id.substring(bar + 1)};
    }

    // ---------------------------------------------------------------- JSON

    public static final class Root {
        public final String id;
        public final String label;

        Root(String id, String label) {
            this.id = id;
            this.label = label;
        }
    }

    public static final class Info {
        public final int version;
        public final String host;
        public final List<Root> roots;

        Info(int version, String host, List<Root> roots) {
            this.version = version;
            this.host = host;
            this.roots = roots;
        }
    }

    public static final class Page {
        public final List<MediaEntry> items;
        public final int total;
        /** -1 when this was the last page. */
        public final int nextOffset;

        Page(List<MediaEntry> items, int total, int nextOffset) {
            this.items = items;
            this.total = total;
            this.nextOffset = nextOffset;
        }
    }

    /** Parses /api/info; throws when the answer is not from the SHARP PC server. */
    public static Info parseInfo(String json) throws IOException {
        try {
            JSONObject o = new JSONObject(json);
            if (!APP_ID.equals(o.optString("app"))) throw new IOException("not a SHARP PC server");
            List<Root> roots = new ArrayList<>();
            JSONArray arr = o.optJSONArray("roots");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject r = arr.optJSONObject(i);
                    if (r == null) continue;
                    String id = r.optString("id", "");
                    if (id.isEmpty() || id.indexOf(SEP) >= 0) continue;
                    String label = r.optString("label", "");
                    roots.add(new Root(id, label.isEmpty() ? id : label));
                }
            }
            return new Info(o.optInt("version", 1), o.optString("host", ""), roots);
        } catch (JSONException e) {
            throw new IOException("bad /api/info answer", e);
        }
    }

    /**
     * Parses one /api/list page into entries. Folders get a folder id; files get a /files/ URL.
     * Files no viewer opens (MediaKind null) and hidden names are dropped.
     */
    public static Page parseList(String base, String json) throws IOException {
        try {
            JSONObject o = new JSONObject(json);
            String root = o.getString("root");
            JSONArray arr = o.optJSONArray("items");
            List<MediaEntry> out = new ArrayList<>();
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject it = arr.optJSONObject(i);
                    if (it == null) continue;
                    String name = it.optString("name", "");
                    String path = it.optString("path", "");
                    if (name.isEmpty() || name.startsWith(".") || path.isEmpty()) continue;
                    String itemRoot = it.optString("root", root);
                    long mtime = it.isNull("mtime") ? 0 : it.optLong("mtime", 0);
                    if ("dir".equals(it.optString("type"))) {
                        out.add(new MediaEntry(folderId(itemRoot, path), name, true, null, -1, mtime, null));
                    } else {
                        if (MediaKind.of(name, null) == null) continue;
                        long size = it.isNull("size") ? -1 : it.optLong("size", -1);
                        out.add(new MediaEntry(folderId(itemRoot, path), name, false, null, size, mtime,
                                fileUrl(base, itemRoot, path)));
                    }
                }
            }
            int total = o.optInt("total", out.size());
            int next = o.isNull("nextOffset") ? -1 : o.optInt("nextOffset", -1);
            return new Page(out, total, next);
        } catch (JSONException e) {
            throw new IOException("bad /api/list answer", e);
        }
    }

    // ---------------------------------------------------------------- HTTP

    /** GET a small JSON answer. Throws with the server's error text on non-200. */
    public static String get(String url, int connectTimeoutMs, int readTimeoutMs) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(connectTimeoutMs);
            c.setReadTimeout(readTimeoutMs);
            c.setInstanceFollowRedirects(false);
            c.setUseCaches(false);
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String body = in == null ? "" : readAll(in, 8 * 1024 * 1024);
            if (code != 200) throw new HttpError(code, body);
            return body;
        } finally {
            c.disconnect();
        }
    }

    static String readAll(InputStream in, int max) throws IOException {
        try (InputStream s = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = s.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > max) throw new IOException("answer too large");
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    /** /api/info of base, or throws. */
    public static Info fetchInfo(String base, int connectTimeoutMs, int readTimeoutMs) throws IOException {
        return parseInfo(get(infoUrl(base), connectTimeoutMs, readTimeoutMs));
    }

    /** Whole folder, following nextOffset. */
    public static List<MediaEntry> fetchFolder(String base, String root, String path) throws IOException {
        List<MediaEntry> all = new ArrayList<>();
        int offset = 0;
        while (true) {
            Page p = parseList(base, get(listUrl(base, root, path, offset, PAGE), 3000, 20000));
            all.addAll(p.items);
            if (p.nextOffset < 0 || p.nextOffset <= offset || all.size() >= MAX_ITEMS) break;
            offset = p.nextOffset;
        }
        return all;
    }

    public static final class HttpError extends IOException {
        public final int code;

        HttpError(int code, String body) {
            super("HTTP " + code + (body == null || body.isEmpty() ? "" : ": " + shorten(body)));
            this.code = code;
        }

        private static String shorten(String s) {
            return s.length() > 200 ? s.substring(0, 200) : s;
        }
    }
}
