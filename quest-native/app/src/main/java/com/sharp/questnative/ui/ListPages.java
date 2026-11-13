package com.sharp.questnative.ui;

import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.util.Log;

import com.sharp.questnative.core.QnActivity;
import com.sharp.questnative.ui.hud.HudModel;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * The non-file pages of the list panel: settings, diagnostics menu, pages registered by other
 * modules (contract 16), button assignments, open-source notices and the keypad. ui draw thread
 * only (Opener calls hop onto it). Owner: ui.
 */
final class ListPages implements UiPages.Opener {
    static final String SETTINGS = "settings", DIAG = "diag", PAGE = "page", BINDINGS = "bindings",
            LICENSES = "licenses", KEYPAD = "keypad";
    private static final long PULL_MS = 100;

    private final ListPanel p;
    private String pageId;
    private HudModel pageModel = new HudModel();
    private boolean pulling;
    private final List<String> history = new ArrayList<>();

    // keypad
    private String keypadTitle = "", keypadChars = "", keypadText = "";
    private UiPages.TextCallback keypadCb;
    private String keypadReturn = "files";

    // licenses
    private List<String> licenseLines;
    private VirtualList scrollList;
    private final Paint lineText = Theme.text(Theme.TEXT, 21, false);

    ListPages(ListPanel panel) {
        p = panel;
        UiPages.opener = this;
    }

    // ---------------------------------------------------------------- navigation

    void go(String mode) {
        history.add(p.mode);
        p.mode = mode;
        if (scrollList != null) scrollList.scroll = 0;
        if (PAGE.equals(mode)) startPull();
        p.relayout();
    }

    void back() {
        if (KEYPAD.equals(p.mode)) {
            finishKeypad(null);
            return;
        }
        p.mode = history.isEmpty() ? "files" : history.remove(history.size() - 1);
        if (PAGE.equals(p.mode)) startPull();
        p.relayout();
    }

    @Override
    public void openPage(String id) {
        UiThread.post(() -> {
            if (UiPages.find(id) == null) return;
            pageId = id;
            UiBridge.nativeCommand("list.open", 0);
            go(PAGE);
        });
    }

    @Override
    public void askText(String title, String initial, String allowedChars, UiPages.TextCallback cb) {
        UiThread.post(() -> {
            if (keypadCb != null) keypadCb.onText(null);
            keypadTitle = title == null ? "" : title;
            keypadText = initial == null ? "" : initial;
            keypadChars = allowedChars == null || allowedChars.isEmpty() ? "0123456789" : allowedChars;
            keypadCb = cb;
            keypadReturn = p.mode;
            UiBridge.nativeCommand("list.open", 0);
            p.mode = KEYPAD;
            p.relayout();
        });
    }

    @Override
    public void invalidate() {
        UiThread.post(() -> {
            if (PAGE.equals(p.mode)) pull();
        });
    }

    private void startPull() {
        pull();
        if (pulling) return;
        pulling = true;
        UiThread.postDelayed(this::pullLoop, PULL_MS);
    }

    private void pullLoop() {
        if (!PAGE.equals(p.mode) || !p.visible) {
            pulling = false;
            return;
        }
        pull();
        UiThread.postDelayed(this::pullLoop, PULL_MS);
    }

    private void pull() {
        UiPage page = pageId == null ? null : UiPages.find(pageId);
        if (page == null) {
            pageModel = new HudModel();
        } else {
            try {
                HudModel m = page.describe();
                pageModel = m == null ? new HudModel() : m;
            } catch (Exception e) {
                Log.w("QuestNative", "[ui] page " + pageId + " describe failed", e);
                pageModel = new HudModel();
            }
        }
        p.relayout();
    }

    // ---------------------------------------------------------------- layout

    void layout() {
        switch (p.mode) {
            case SETTINGS: layoutSettings(); break;
            case DIAG: layoutDiagMenu(); break;
            case PAGE: layoutPage(); break;
            case BINDINGS: layoutBindings(); break;
            case LICENSES: layoutLicenses(); break;
            case KEYPAD: layoutKeypad(); break;
            default: break;
        }
    }

    private float header(String title) {
        float pad = 20;
        p.widgets.add(new Widgets.Button("page.back", "", "prev", this::back).at(pad, 16, pad + 60, 72));
        p.widgets.add(new Widgets.Label(title, Theme.TEXT, 30, true, true).at(pad + 72, 16, p.width - 100, 72));
        p.widgets.add(new Widgets.Button("page.close", "", "close", () -> UiBridge.nativeCommand("list.close", 0))
                .at(p.width - 76, 16, p.width - pad, 72));
        return 92;
    }

    private void layoutSettings() {
        float pad = 24, y = header("설정"), right = p.width - pad;
        Settings s = PanelHost.settings();
        p.widgets.add(new Widgets.Slider("set.scale", "해상도 배율", s.scale, 0.6f, 1.2f, 0.1f, "x",
                (v, phase) -> {
                    if (phase == 1) s.setScale(v, true);
                }).at(pad, y, right, y + 60));
        y += 70;
        float half = (right - pad - 10) / 2f;
        p.widgets.add(new Widgets.Choice("set.refresh", "주사율", Arrays.asList(Settings.REFRESH_LABELS), s.refresh,
                (v, phase) -> s.setRefresh((int) v)).at(pad, y, pad + half, y + 60));
        p.widgets.add(new Widgets.Choice("set.foveation", "포비에이션", Arrays.asList(Settings.FOVEATION_LABELS),
                s.foveation, (v, phase) -> s.setFoveation((int) v)).at(pad + half + 10, y, right, y + 60));
        y += 70;
        p.widgets.add(new Widgets.Choice("set.slideshow", "슬라이드쇼 간격", Arrays.asList(Settings.SLIDESHOW_LABELS),
                s.slideshow, (v, phase) -> s.setSlideshow((int) v)).at(pad, y, pad + half, y + 60));
        y += 70;
        float third = (right - pad - 20) / 3f;
        p.widgets.add(new Widgets.Button("set.bindings", "버튼 바꾸기", "", () -> go(BINDINGS))
                .at(pad, y, pad + third, y + 64));
        p.widgets.add(new Widgets.Button("set.licenses", "오픈소스 고지", "", () -> go(LICENSES))
                .at(pad + third + 10, y, pad + 2 * third + 10, y + 64));
        p.widgets.add(new Widgets.Button("set.diag", "진단", "diag", () -> go(DIAG))
                .at(pad + 2 * third + 20, y, right, y + 64));
        y += 80;
        List<UiPage> pages = UiPages.inGroup(UiPage.GROUP_SETTINGS);
        if (!pages.isEmpty()) {
            p.widgets.add(new Widgets.Label("파일 출처·기타", Theme.TEXT_DIM, 22, false, true).at(pad, y, right, y + 30));
            y += 36;
            p.widgets.add(pageList(pages).at(pad, y, right, p.height - pad));
        }
    }

    private void layoutDiagMenu() {
        float pad = 24, y = header("진단"), right = p.width - pad;
        String version = "앱 " + appVersion();
        p.widgets.add(new Widgets.Label(version, Theme.TEXT_DIM, 22, false, true).at(pad, y, right, y + 32));
        y += 44;
        List<UiPage> pages = UiPages.inGroup(UiPage.GROUP_DIAGNOSTICS);
        if (pages.isEmpty()) {
            p.widgets.add(new Widgets.Label("등록된 진단 화면이 없어요", Theme.TEXT_DIM, 24, false, false)
                    .at(pad, 300, right, 350));
            return;
        }
        p.widgets.add(pageList(pages).at(pad, y, right, p.height - pad));
    }

    private VirtualList pageList(List<UiPage> pages) {
        Paint text = Theme.text(Theme.TEXT, 26, false);
        return new VirtualList("page.list", 64, new VirtualList.Rows() {
            @Override
            public int count() {
                return pages.size();
            }

            @Override
            public void drawRow(Canvas c, int i, RectF row, boolean hovered) {
                LabelFit.draw(c, text, pages.get(i).title() + "  ›", 0, row.centerY(), row.width() - 32,
                        new float[] {26, 24, 22}, 1, row.height(), true, row.left + 16);
            }

            @Override
            public void onClick(int i) {
                pageId = pages.get(i).id();
                go(PAGE);
            }
        });
    }

    private void layoutPage() {
        UiPage page = pageId == null ? null : UiPages.find(pageId);
        float pad = 24, y = header(page == null ? "" : page.title()), right = p.width - pad;
        if (page == null) return;
        if (!pageModel.subtitle.isEmpty()) {
            p.widgets.add(new Widgets.Label(pageModel.subtitle, Theme.TEXT_DIM, 22, false, true).at(pad, y, right, y + 30));
            y += 34;
        }
        if (!pageModel.status.isEmpty()) {
            p.widgets.add(new Widgets.Label(pageModel.status, Theme.WARNING, 22, false, true).at(pad, y, right, y + 30));
            y += 34;
        }
        float maxBottom = pageModel.diagnostics.isEmpty() ? p.height - pad : Math.min(p.height - 200, y + 6 * 68);
        y = ControlGrid.layout(p.widgets, pageModel.controls, pad, y, right, maxBottom, 60, (id, v, phase) -> {
            try {
                page.onAction(id, v, phase);
            } catch (Exception e) {
                Log.w("QuestNative", "[ui] page " + pageId + " action " + id + " failed", e);
            }
            pull();
        });
        if (!pageModel.diagnostics.isEmpty()) {
            List<String> lines = wrap(pageModel.diagnostics, right - pad - 30);
            float keep = scrollList != null && "page.diag".equals(scrollList.id) ? scrollList.scroll : 0;
            scrollList = lineList("page.diag", lines);
            scrollList.at(pad, y + 4, right, p.height - pad);
            scrollList.scrollTo(keep);
            p.widgets.add(scrollList);
        }
    }

    private void layoutBindings() {
        float pad = 24, y = header("버튼 바꾸기"), right = p.width - pad;
        Bindings b = PanelHost.bindings();
        List<String> ids = Bindings.actionIds();
        List<String> labels = Bindings.actionLabels();
        float colW = (right - pad - 16) / 2f;
        float rowH = 56;
        for (int i = 0; i < Bindings.SLOTS.length; i++) {
            final String slot = Bindings.SLOTS[i];
            int col = i % 2, row = i / 2;
            float x = pad + col * (colW + 16), top = y + row * (rowH + 10);
            int index = Math.max(0, ids.indexOf(b.get(slot)));
            p.widgets.add(new Widgets.Choice("bind." + slot, Bindings.SLOT_LABELS[i], labels, index,
                    (v, phase) -> b.set(slot, ids.get((int) v))).at(x, top, x + colW, top + rowH));
        }
        float by = y + 5 * (rowH + 10) + 10;
        Widgets.Label note = new Widgets.Label(
                "재생 컨트롤 동작(재생·10초 등)은 그 동작이 있는 뷰어에서만 듣습니다.\n스틱·트리거·그립은 뷰어가 씁니다.",
                Theme.TEXT_DIM, 20, false, true);
        note.maxLines = 2;
        p.widgets.add(note.at(pad, by, right, by + 60));
        p.widgets.add(new Widgets.Button("bind.reset", "기본값으로", "", () -> {
            b.resetDefaults();
            p.relayout();
            UiBridge.showToast("버튼 배정을 기본값으로 되돌렸어요", 2);
        }).at(pad, p.height - 84, pad + 260, p.height - 20));
    }

    private void layoutLicenses() {
        float pad = 24, y = header("오픈소스 고지"), right = p.width - pad;
        if (licenseLines == null) licenseLines = wrap(readLicenses(), right - pad - 30);
        boolean same = scrollList != null && "page.licenses".equals(scrollList.id);
        float keep = same ? scrollList.scroll : 0;
        scrollList = lineList("page.licenses", licenseLines);
        scrollList.at(pad, y, right, p.height - pad);
        scrollList.scrollTo(keep);
        p.widgets.add(scrollList);
    }

    private void layoutKeypad() {
        float pad = 24, y = header(keypadTitle), right = p.width - pad;
        Widgets.Label field = new Widgets.Label(keypadText.isEmpty() ? " " : keypadText, Theme.TEXT, 40, true, false);
        p.widgets.add(new Widgets.Button("key.field", "", "", null).at(pad, y, right, y + 76));
        field.at(pad + 10, y, right - 10, y + 76);
        p.widgets.add(field);
        y += 92;
        List<String> keys = new ArrayList<>();
        for (int i = 0; i < keypadChars.length(); ) {
            int cp = keypadChars.codePointAt(i);
            keys.add(new String(Character.toChars(cp)));
            i += Character.charCount(cp);
        }
        int cols = 6;
        float kw = (right - pad - 10 * (cols - 1)) / cols, kh = 64;
        for (int i = 0; i < keys.size(); i++) {
            final String k = keys.get(i);
            float x = pad + (i % cols) * (kw + 10), top = y + (i / cols) * (kh + 10);
            p.widgets.add(new Widgets.Button("key." + k, k, "", () -> {
                if (keypadText.length() < 64) keypadText += k;
                p.relayout();
            }).at(x, top, x + kw, top + kh));
        }
        float by = p.height - 90;
        float bw = (right - pad - 30) / 4f;
        p.widgets.add(new Widgets.Button("key.back", "⌫", "", () -> {
            if (!keypadText.isEmpty()) keypadText = keypadText.substring(0, keypadText.offsetByCodePoints(keypadText.length(), -1));
            p.relayout();
        }).at(pad, by, pad + bw, by + 70));
        p.widgets.add(new Widgets.Button("key.clear", "지우기", "", () -> {
            keypadText = "";
            p.relayout();
        }).at(pad + bw + 10, by, pad + 2 * bw + 10, by + 70));
        p.widgets.add(new Widgets.Button("key.cancel", "취소", "", () -> finishKeypad(null))
                .at(pad + 2 * bw + 20, by, pad + 3 * bw + 20, by + 70));
        p.widgets.add(new Widgets.Button("key.ok", "확인", "", () -> finishKeypad(keypadText))
                .at(pad + 3 * bw + 30, by, right, by + 70));
    }

    private void finishKeypad(String text) {
        UiPages.TextCallback cb = keypadCb;
        keypadCb = null;
        p.mode = keypadReturn;
        if (PAGE.equals(p.mode)) startPull();
        p.relayout();
        if (cb != null) {
            try {
                cb.onText(text);
            } catch (Exception e) {
                Log.w("QuestNative", "[ui] askText callback failed", e);
            }
        }
    }

    // ---------------------------------------------------------------- text helpers

    private VirtualList lineList(String id, List<String> lines) {
        return new VirtualList(id, 30, new VirtualList.Rows() {
            @Override
            public int count() {
                return lines.size();
            }

            @Override
            public void drawRow(Canvas c, int i, RectF row, boolean hovered) {
                lineText.setTextAlign(Paint.Align.LEFT);
                lineText.setTextSize(21);
                Paint.FontMetrics fm = lineText.getFontMetrics();
                c.drawText(lines.get(i), row.left + 8, row.centerY() - (fm.ascent + fm.descent) / 2f, lineText);
            }

            @Override
            public void onClick(int i) {}
        });
    }

    /** Wraps each paragraph per character to the width (Korean has no spaces to break on). */
    private List<String> wrap(List<String> paragraphs, float width) {
        lineText.setTextSize(21);
        List<String> out = new ArrayList<>();
        for (String para : paragraphs) {
            if (para.isEmpty()) {
                out.add("");
                continue;
            }
            StringBuilder line = new StringBuilder();
            for (int i = 0; i < para.length(); ) {
                int cp = para.codePointAt(i);
                String ch = new String(Character.toChars(cp));
                i += Character.charCount(cp);
                if (line.length() > 0 && lineText.measureText(line + ch) > width) {
                    out.add(line.toString());
                    line.setLength(0);
                    if (ch.equals(" ")) continue;
                }
                line.append(ch);
            }
            out.add(line.toString());
        }
        return out;
    }

    /**
     * The notice screen (docs/licenses.md 6): licenses.md, then every third-party LICENSE original
     * (assets/licenses/third_party), then the license texts (assets/licenses/texts, Apache-2.0 first).
     * All copied at build time by qnCopyLicenses.
     */
    private List<String> readLicenses() {
        List<String> out = new ArrayList<>();
        QnActivity a = QnActivity.current();
        if (a == null) return out;
        List<String> files = new ArrayList<>();
        files.add("licenses/licenses.md");
        for (String dir : new String[] {"licenses/third_party", "licenses/texts"}) {
            try {
                String[] names = a.getAssets().list(dir);
                if (names == null) continue;
                List<String> sorted = new ArrayList<>(Arrays.asList(names));
                java.util.Collections.sort(sorted, (x, y) -> x.startsWith("Apache") ? -1 : y.startsWith("Apache") ? 1
                        : x.compareTo(y));
                for (String n : sorted) files.add(dir + "/" + n);
            } catch (Exception e) {
                Log.w("QuestNative", "[ui] license assets missing: " + dir, e);
            }
        }
        for (String path : files) {
            boolean md = path.endsWith(".md") && path.equals("licenses/licenses.md");
            try (BufferedReader r = new BufferedReader(new InputStreamReader(a.getAssets().open(path),
                    StandardCharsets.UTF_8))) {
                if (!out.isEmpty()) {
                    out.add("");
                    out.add("──────── " + path.substring(path.lastIndexOf('/') + 1) + " ────────");
                    out.add("");
                }
                String line;
                while ((line = r.readLine()) != null) {
                    if (md) {
                        String t = cleanMarkdown(line);
                        if (t != null) out.add(t);
                    } else {
                        out.add(line);  // license originals are shown verbatim
                    }
                }
            } catch (Exception e) {
                Log.w("QuestNative", "[ui] license asset missing: " + path, e);
            }
        }
        return out;
    }

    /** Markdown -> plain line: table rows joined with " · ", separator rows dropped. null = skip. */
    static String cleanMarkdown(String line) {
        String t = line.replace("`", "").replace("**", "");
        String trimmed = t.trim();
        if (trimmed.matches("\\|?\\s*-{3,}.*")) return null;
        if (trimmed.startsWith("|")) {
            String[] cells = trimmed.substring(1, trimmed.endsWith("|") ? trimmed.length() - 1 : trimmed.length())
                    .split("\\|");
            StringBuilder sb = new StringBuilder();
            for (String c : cells) {
                String v = c.trim();
                if (v.isEmpty()) continue;
                if (sb.length() > 0) sb.append(" · ");
                sb.append(v);
            }
            return sb.toString();
        }
        return t.replaceFirst("^#+\\s*", "");
    }

    private static String appVersion() {
        QnActivity a = QnActivity.current();
        if (a == null) return "";
        try {
            return a.getPackageManager().getPackageInfo(a.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }
}
