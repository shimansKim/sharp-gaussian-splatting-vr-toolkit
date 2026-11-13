package com.sharp.questnative.ui;

import android.util.Log;

import java.util.ArrayList;
import java.util.List;

/**
 * Registry and helpers for {@link UiPage}s (docs/module-contract.md 16). Thread-safe. Owner: ui.
 */
public final class UiPages {
    /** Result of {@link #askText}. Called on the ui draw thread; text is null when cancelled. */
    public interface TextCallback {
        void onText(String text);
    }

    private static final List<UiPage> pages = new ArrayList<>();
    static volatile Opener opener;  // set by the list panel

    interface Opener {
        void openPage(String id);

        void askText(String title, String initial, String allowedChars, TextCallback cb);

        void invalidate();
    }

    private UiPages() {}

    public static synchronized void register(UiPage page) {
        pages.removeIf(p -> p.id().equals(page.id()));
        pages.add(page);
    }

    public static synchronized void unregister(String id) {
        pages.removeIf(p -> p.id().equals(id));
    }

    public static synchronized List<UiPage> inGroup(String group) {
        List<UiPage> out = new ArrayList<>();
        for (UiPage p : pages) if (group.equals(p.group())) out.add(p);
        return out;
    }

    public static synchronized UiPage find(String id) {
        for (UiPage p : pages) if (p.id().equals(id)) return p;
        return null;
    }

    /** Opens the list panel on this page. */
    public static void open(String id) {
        Opener o = opener;
        if (o != null) o.openPage(id);
        else Log.i("QuestNative", "[ui] page " + id + " requested before the list panel is ready");
    }

    /** The page content changed; redraw soon. */
    public static void invalidate() {
        Opener o = opener;
        if (o != null) o.invalidate();
    }

    /**
     * On-panel keypad for short text such as a PC address. allowedChars: the keys to show, e.g.
     * "0123456789.:" (digits always fit; letters are not offered yet). The keypad returns to the
     * page that asked when it closes.
     */
    public static void askText(String title, String initial, String allowedChars, TextCallback cb) {
        Opener o = opener;
        if (o != null) o.askText(title, initial, allowedChars, cb);
        else if (cb != null) cb.onText(null);
    }
}
