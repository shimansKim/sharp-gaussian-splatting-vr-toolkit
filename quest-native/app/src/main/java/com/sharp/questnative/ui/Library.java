package com.sharp.questnative.ui;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import com.sharp.questnative.core.MediaEntry;
import com.sharp.questnative.core.MediaKind;
import com.sharp.questnative.core.MediaSource;
import com.sharp.questnative.core.NativeBridge;
import com.sharp.questnative.core.SourceRegistry;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.text.Collator;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Deque;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Browsing state behind the list panel: folder tree over all sources, the selected folder's
 * entries (filtered and sorted), "최근" (recently opened) and "보관함" (kept/pinned), and
 * previous/next within the current list. ui draw thread only; I/O runs on "QnIo". Owner: ui.
 */
final class Library {
    static final String[] KIND_LABELS = {"전체", "PLY", "영상", "사진"};
    static final String[] KIND_VALUES = {null, MediaKind.SPLAT, MediaKind.VIDEO, MediaKind.IMAGE};
    static final String[] SORT_LABELS = {"최신순", "이름순", "크기순", "확장자순"};
    static final String RECENT = "ui:recent";
    static final String KEPT = "ui:kept";
    private static final int RECENT_MAX = 100;

    static final class Node {
        String sourceId;   // RECENT / KEPT for the virtual roots
        String folderId;   // null = source root
        String name;
        int depth;
        boolean expanded, loaded, loading;
        String error;
        List<Item> cache;  // last listing of this folder
        final List<Node> children = new ArrayList<>();
    }

    static final class Item {
        final MediaEntry entry;
        final String sourceId;
        final String kind;  // MediaKind or null; folders: null

        Item(MediaEntry entry, String sourceId) {
            this.entry = entry;
            this.sourceId = sourceId;
            this.kind = entry.folder ? null : MediaKind.of(entry.name, entry.mimeType);
        }
    }

    interface Listener {
        void onLibraryChanged();
    }

    private static final ExecutorService io = Executors.newSingleThreadExecutor(r -> new Thread(r, "QnIo"));
    private static final Collator collator = Collator.getInstance(Locale.KOREAN);

    final List<Node> roots = new ArrayList<>();
    Node selected;
    final List<Item> view = new ArrayList<>();
    private List<Item> raw = new ArrayList<>();
    int kindFilter = 0;
    int sort = 0;
    String openKey;  // sourceId + "|" + entry id of the open file
    private final Deque<Node> back = new ArrayDeque<>();
    private Listener listener;
    private SharedPreferences prefs;

    void init(Context context, Listener l) {
        prefs = context.getSharedPreferences("ui_library", Context.MODE_PRIVATE);
        kindFilter = prefs.getInt("kind", 0);
        sort = prefs.getInt("sort", 0);
        listener = l;
        refreshRoots();
    }

    // ---------------------------------------------------------------- tree

    void refreshRoots() {
        roots.clear();
        roots.add(virtualRoot(RECENT, "최근"));
        roots.add(virtualRoot(KEPT, "보관함"));
        for (MediaSource s : SourceRegistry.all()) {
            Node n = new Node();
            n.sourceId = s.id();
            n.name = s.displayName();
            roots.add(n);
            expand(n);
        }
        if (selected == null) select(roots.get(0), false);
        changed();
    }

    private static Node virtualRoot(String id, String name) {
        Node n = new Node();
        n.sourceId = id;
        n.name = name;
        n.loaded = true;
        return n;
    }

    /** Tree rows in display order. */
    List<Node> visibleNodes() {
        List<Node> out = new ArrayList<>();
        for (Node r : roots) addVisible(r, out);
        return out;
    }

    private void addVisible(Node n, List<Node> out) {
        out.add(n);
        if (n.expanded) for (Node c : n.children) addVisible(c, out);
    }

    void toggle(Node n) {
        if (n != selected) {
            select(n, true);
            if (!n.expanded) expand(n);
        } else if (n.expanded) {
            n.expanded = false;
        } else {
            expand(n);
        }
        changed();
    }

    private void expand(Node n) {
        n.expanded = true;
        if (!n.loaded && !n.loading && !isVirtual(n)) load(n);
    }

    static boolean isVirtual(Node n) {
        return RECENT.equals(n.sourceId) || KEPT.equals(n.sourceId);
    }

    void select(Node n, boolean remember) {
        if (remember && selected != null && selected != n) back.push(selected);
        selected = n;
        if (isVirtual(n)) {
            raw = loadStored(n.sourceId);
            rebuildView();
        } else if (n.loaded) {
            rebuildView();
        } else {
            raw = new ArrayList<>();
            rebuildView();
            load(n);
        }
        changed();
    }

    boolean canGoBack() {
        return !back.isEmpty();
    }

    void goBack() {
        if (back.isEmpty()) return;
        select(back.pop(), false);
    }

    /** Re-read the selected folder (e.g. after granting access). */
    void reload() {
        if (selected == null) return;
        if (isVirtual(selected)) {
            select(selected, false);
            return;
        }
        selected.loaded = false;
        load(selected);
    }

    private void load(Node n) {
        MediaSource src = SourceRegistry.find(n.sourceId);
        if (src == null) return;
        n.loading = true;
        n.error = null;
        io.execute(() -> {
            List<MediaEntry> entries;
            String error = null;
            try {
                entries = src.list(n.folderId);
            } catch (IOException | RuntimeException e) {
                Log.w("QuestNative", "[ui] list failed " + n.sourceId + " " + n.folderId, e);
                entries = Collections.emptyList();
                error = "폴더를 읽지 못했어요";
            }
            List<MediaEntry> result = entries;
            String err = error;
            UiThread.post(() -> {
                n.loading = false;
                n.loaded = err == null;
                n.error = err;
                n.children.clear();
                List<Item> items = new ArrayList<>();
                for (MediaEntry e : result) {
                    items.add(new Item(e, n.sourceId));
                    if (e.folder) {
                        Node c = new Node();
                        c.sourceId = n.sourceId;
                        c.folderId = e.id;
                        c.name = e.name;
                        c.depth = n.depth + 1;
                        n.children.add(c);
                    }
                }
                n.children.sort((a, b) -> collator.compare(a.name, b.name));
                n.cache = items;
                if (n == selected) {
                    raw = items;
                    rebuildView();
                }
                changed();
            });
        });
    }

    // ---------------------------------------------------------------- list

    void setKindFilter(int k) {
        kindFilter = k;
        prefs.edit().putInt("kind", k).apply();
        rebuildView();
        changed();
    }

    void setSort(int s) {
        sort = s;
        prefs.edit().putInt("sort", s).apply();
        rebuildView();
        changed();
    }

    private void rebuildView() {
        if (selected != null && !isVirtual(selected) && selected.cache != null) raw = selected.cache;
        view.clear();
        String want = KIND_VALUES[kindFilter];
        for (Item it : raw) {
            if (it.entry.folder) {
                if (!isVirtual(selected)) view.add(it);
            } else if (it.kind != null && (want == null || want.equals(it.kind))) {
                view.add(it);
            }
        }
        if (selected != null && RECENT.equals(selected.sourceId)) return;  // keep most-recent-first order
        Comparator<Item> byName = (a, b) -> collator.compare(a.entry.name, b.entry.name);
        Comparator<Item> cmp;
        switch (sort) {
            case 1: cmp = byName; break;
            case 2: cmp = (a, b) -> Long.compare(b.entry.size, a.entry.size); break;
            case 3: cmp = (a, b) -> MediaKind.extension(a.entry.name).compareTo(MediaKind.extension(b.entry.name)); break;
            default: cmp = (a, b) -> Long.compare(b.entry.modifiedMs, a.entry.modifiedMs); break;
        }
        Comparator<Item> full = cmp.thenComparing(byName);
        view.sort((a, b) -> a.entry.folder != b.entry.folder ? (a.entry.folder ? -1 : 1)
                : a.entry.folder ? byName.compare(a, b) : full.compare(a, b));
    }

    /** Opens a folder row (navigates) or a file row (viewer). */
    void activate(Item it) {
        if (it.entry.folder) {
            Node parent = selected;
            for (Node c : parent.children) {
                if (c.folderId.equals(it.entry.id)) {
                    parent.expanded = true;
                    select(c, true);
                    expand(c);
                    changed();
                    return;
                }
            }
            return;
        }
        open(it);
    }

    void open(Item it) {
        MediaSource src = SourceRegistry.find(it.sourceId);
        openKey = key(it);
        remember(RECENT, it, true);
        changed();
        io.execute(() -> {
            int fd = -1;
            if (src != null) {
                try {
                    fd = src.openFd(it.entry);
                } catch (IOException | RuntimeException e) {
                    Log.w("QuestNative", "[ui] openFd failed " + it.entry.name, e);
                }
            }
            boolean ok = NativeBridge.openMedia(it.entry, it.sourceId, fd);
            if (!ok) {
                if (fd >= 0) closeFd(fd);
                UiBridge.showToast("앱이 아직 준비되지 않았어요", 3);
            }
        });
    }

    private static void closeFd(int fd) {
        try {
            android.os.ParcelFileDescriptor.adoptFd(fd).close();
        } catch (IOException ignored) {
        }
    }

    int openIndex() {
        if (openKey == null) return -1;
        for (int i = 0; i < view.size(); i++) if (openKey.equals(key(view.get(i)))) return i;
        return -1;
    }

    /** Previous (-1) or next (+1) file in the current list; wraps around. */
    void step(int dir) {
        List<Integer> files = new ArrayList<>();
        for (int i = 0; i < view.size(); i++) if (!view.get(i).entry.folder) files.add(i);
        if (files.isEmpty()) {
            UiBridge.showToast("넘길 파일이 없어요", 2);
            return;
        }
        int cur = files.indexOf(openIndex());
        int next = cur < 0 ? (dir > 0 ? 0 : files.size() - 1) : (cur + dir + files.size()) % files.size();
        open(view.get(files.get(next)));
    }

    // ---------------------------------------------------------------- recent / kept

    static String key(Item it) {
        return it.sourceId + "|" + it.entry.id;
    }

    boolean isKept(Item it) {
        for (Item k : loadStored(KEPT)) if (key(k).equals(key(it))) return true;
        return false;
    }

    void toggleKept(Item it) {
        if (isKept(it)) {
            List<Item> list = loadStored(KEPT);
            list.removeIf(k -> key(k).equals(key(it)));
            store(KEPT, list);
            UiBridge.showToast("보관함에서 뺐어요", 2);
        } else {
            remember(KEPT, it, false);
            UiBridge.showToast("보관함에 넣었어요", 2);
        }
        if (selected != null && KEPT.equals(selected.sourceId)) select(selected, false);
        changed();
    }

    private void remember(String which, Item it, boolean front) {
        List<Item> list = loadStored(which);
        list.removeIf(k -> key(k).equals(key(it)));
        if (front) list.add(0, it);
        else list.add(it);
        while (list.size() > RECENT_MAX) list.remove(list.size() - 1);
        store(which, list);
    }

    private List<Item> loadStored(String which) {
        List<Item> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(prefs.getString(which, "[]"));
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                MediaEntry e = new MediaEntry(o.getString("id"), o.getString("name"), false,
                        o.optString("mime", null), o.optLong("size", -1), o.optLong("mtime", 0),
                        o.optString("uri", null));
                out.add(new Item(e, o.getString("source")));
            }
        } catch (Exception e) {
            Log.w("QuestNative", "[ui] bad stored list " + which, e);
        }
        return out;
    }

    private void store(String which, List<Item> list) {
        JSONArray a = new JSONArray();
        try {
            for (Item it : list) {
                JSONObject o = new JSONObject();
                o.put("source", it.sourceId);
                o.put("id", it.entry.id);
                o.put("name", it.entry.name);
                if (it.entry.mimeType != null) o.put("mime", it.entry.mimeType);
                o.put("size", it.entry.size);
                o.put("mtime", it.entry.modifiedMs);
                if (it.entry.uri != null) o.put("uri", it.entry.uri);
                a.put(o);
            }
        } catch (Exception e) {
            Log.w("QuestNative", "[ui] store failed", e);
        }
        prefs.edit().putString(which, a.toString()).apply();
    }

    private void changed() {
        if (listener != null) listener.onLibraryChanged();
    }
}
