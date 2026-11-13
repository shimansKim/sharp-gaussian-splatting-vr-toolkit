package com.sharp.questnative.ui;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Controller button assignments (port of quest-app core/bindings.js, reduced to the buttons the ui
 * owns: A, B, X, Y, menu; short and long press). Actions are app actions ("ui.toggle", ...) or
 * "hud:&lt;control id&gt;" for the active viewer (contract 14.5). Stored in SharedPreferences and sent
 * to native as "slot=action;slot=action". ui draw thread only. Owner: ui.
 */
final class Bindings {
    static final String[] SLOTS = {"A.short", "A.long", "B.short", "B.long", "X.short", "X.long", "Y.short", "Y.long",
            "menu.short", "menu.long"};
    static final String[] SLOT_LABELS = {"A 짧게", "A 길게", "B 짧게", "B 길게", "X 짧게", "X 길게", "Y 짧게", "Y 길게",
            "메뉴 짧게", "메뉴 길게"};

    /** Assignable actions in menu order: id -> Korean label. */
    static final Map<String, String> ACTIONS = new LinkedHashMap<>();

    static {
        ACTIONS.put("", "없음");
        ACTIONS.put("ui.toggle", "UI 켜기·끄기");
        ACTIONS.put("ui.move", "UI를 보는 곳으로");
        ACTIONS.put("list.toggle", "목록 열기·닫기");
        ACTIONS.put("nav.prev", "이전 파일");
        ACTIONS.put("nav.next", "다음 파일");
        ACTIONS.put("slideshow.toggle", "슬라이드쇼");
        ACTIONS.put("hud.toggle", "재생 컨트롤 보이기");
        ACTIONS.put("hud:play", "재생·일시정지");
        ACTIONS.put("hud:back10", "10초 뒤로");
        ACTIONS.put("hud:fwd10", "10초 앞으로");
        ACTIONS.put("hud:mute", "소리 끔");
        ACTIONS.put("hud:loop", "반복");
        ACTIONS.put("hud:layout", "형식 바꾸기");
        ACTIONS.put("hud:swapEyes", "눈 바꿈");
        ACTIONS.put("hud:recenter", "화면 위치 맞춤");
        ACTIONS.put("hud:zoomIn", "줌 +");
        ACTIONS.put("hud:zoomOut", "줌 -");
        ACTIONS.put("hud:fitView", "PLY 전체 보기");
        ACTIONS.put("hud:quality", "PLY 화질 바꾸기");
    }

    static final Map<String, String> DEFAULTS = new LinkedHashMap<>();

    static {
        DEFAULTS.put("B.short", "ui.toggle");
        DEFAULTS.put("Y.short", "ui.toggle");
        DEFAULTS.put("B.long", "ui.move");
        DEFAULTS.put("Y.long", "ui.move");
        DEFAULTS.put("A.short", "list.toggle");
        DEFAULTS.put("X.short", "nav.prev");
        DEFAULTS.put("X.long", "nav.next");
    }

    /** Seconds a change stays on trial before it is reverted unless kept (quest-app: 10 s). */
    static final int CONFIRM_SECONDS = 10;

    private SharedPreferences prefs;
    private final Map<String, String> map = new LinkedHashMap<>();
    private Map<String, String> before;  // table before the change on trial, or null
    private long confirmUntilMs;

    void init(Context c) {
        prefs = c.getSharedPreferences("ui_bindings", Context.MODE_PRIVATE);
        map.clear();
        for (String slot : SLOTS) {
            String def = DEFAULTS.containsKey(slot) ? DEFAULTS.get(slot) : "";
            map.put(slot, prefs.getString(slot, def));
        }
    }

    String get(String slot) {
        String v = map.get(slot);
        return v == null ? "" : v;
    }

    void set(String slot, String action) {
        beginTrial();
        map.put(slot, action);
        if (prefs != null) prefs.edit().putString(slot, action).apply();
        push();
    }

    void resetDefaults() {
        beginTrial();
        for (String slot : SLOTS) {
            String def = DEFAULTS.containsKey(slot) ? DEFAULTS.get(slot) : "";
            map.put(slot, def);
        }
        if (prefs != null) prefs.edit().clear().apply();
        push();
    }

    private void beginTrial() {
        if (before == null) before = new LinkedHashMap<>(map);
        confirmUntilMs = android.os.SystemClock.uptimeMillis() + CONFIRM_SECONDS * 1000L;
    }

    /** True while a change waits for [유지]. */
    boolean onTrial() {
        return before != null;
    }

    /** Whole seconds left before the automatic revert. */
    int secondsLeft() {
        return (int) Math.max(0, Math.ceil((confirmUntilMs - android.os.SystemClock.uptimeMillis()) / 1000.0));
    }

    void keep() {
        before = null;
    }

    /** Back to the table before the change on trial. */
    void revert() {
        if (before == null) return;
        map.clear();
        map.putAll(before);
        before = null;
        SharedPreferences.Editor e = prefs == null ? null : prefs.edit();
        for (String slot : SLOTS) {
            if (e != null) e.putString(slot, get(slot));
        }
        if (e != null) e.apply();
        push();
    }

    static String slotLabel(String slot) {
        for (int i = 0; i < SLOTS.length; i++) if (SLOTS[i].equals(slot)) return SLOT_LABELS[i];
        return slot;
    }

    static List<String> actionIds() {
        return Arrays.asList(ACTIONS.keySet().toArray(new String[0]));
    }

    static List<String> actionLabels() {
        return Arrays.asList(ACTIONS.values().toArray(new String[0]));
    }

    /** Sends the table to native (ui_module.cpp parses "bindings:slot=action;..."). */
    void push() {
        StringBuilder sb = new StringBuilder("bindings:");
        for (String slot : SLOTS) sb.append(slot).append('=').append(get(slot)).append(';');
        UiBridge.nativeCommand(sb.toString(), 0);
    }
}
