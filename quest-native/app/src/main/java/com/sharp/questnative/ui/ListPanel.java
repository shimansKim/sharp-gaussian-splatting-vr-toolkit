package com.sharp.questnative.ui;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;

import android.util.Log;

import com.sharp.questnative.core.MediaKind;
import com.sharp.questnative.core.MediaSource;
import com.sharp.questnative.core.QnActivity;
import com.sharp.questnative.core.SourceRegistry;
import com.sharp.questnative.source.DeviceSource;

import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Shared list panel: folder tree (left), file list (right) with kind filter, sort, jumps and the
 * "보관" star, plus the device-storage access card. Port of quest-app ui/vr-panel.js list page.
 * Owner: ui.
 */
final class ListPanel extends Panel implements Library.Listener {
    static final int JUMP_ROWS = 100;

    final Library library = new Library();
    private boolean initialized;
    private List<Library.Node> nodes;
    private VirtualList tree, files;
    private float treeScroll, filesScroll;
    private Library.Node lastSelected;

    private final Paint rowText = Theme.text(Theme.TEXT, 26, false);
    private final Paint metaText = Theme.text(Theme.TEXT_DIM, 19, false);
    private final Paint badgeText = Theme.text(Color.WHITE, 18, true);
    private final Paint badgeBg = Theme.fill(Color.GRAY);
    private final Paint star = Theme.text(Theme.WARNING, 30, false);
    private final Paint openMark = Theme.fill(Theme.ACCENT);
    private final RectF tmp = new RectF();
    private final SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.KOREA);

    private void ensureInit() {
        if (initialized) return;
        QnActivity a = QnActivity.current();
        if (a == null) return;
        initialized = true;
        library.init(a, this);
    }

    @Override
    public void onLibraryChanged() {
        relayout();
    }

    @Override
    void onVisibility(boolean v) {
        if (!v) return;
        boolean first = !initialized;
        ensureInit();
        if (!first) library.reload();  // permissions may have changed while hidden
        relayout();
    }

    @Override
    void layout() {
        if (!initialized) {
            widgets.add(new Widgets.Label("준비 중…", Theme.TEXT_DIM, 26, false, false).at(0, 0, width, height));
            return;
        }
        float pad = 20;
        if (tree != null) treeScroll = tree.scroll;
        if (files != null && library.selected == lastSelected) filesScroll = files.scroll;
        else filesScroll = 0;
        lastSelected = library.selected;

        // header
        Widgets.Button backBtn = new Widgets.Button("list.back", "", "prev", library::goBack);
        backBtn.enabled = library.canGoBack();
        widgets.add(backBtn.at(pad, 16, pad + 60, 72));
        String title = library.selected == null ? "파일" : library.selected.name;
        widgets.add(new Widgets.Label(title, Theme.TEXT, 30, true, true).at(pad + 72, 16, 470, 72));
        widgets.add(new Widgets.Choice("list.kind", "", Arrays.asList(Library.KIND_LABELS), library.kindFilter,
                (v, p) -> library.setKindFilter((int) v)).at(480, 16, 660, 72));
        widgets.add(new Widgets.Choice("list.sort", "", Arrays.asList(Library.SORT_LABELS), library.sort,
                (v, p) -> library.setSort((int) v)).at(670, 16, 870, 72));
        widgets.add(new Widgets.Button("list.close", "", "close", () -> UiBridge.nativeCommand("list.close", 0))
                .at(width - 76, 16, width - pad, 72));

        // tree
        nodes = library.visibleNodes();
        tree = new VirtualList("list.tree", 52, new VirtualList.Rows() {
            @Override
            public int count() {
                return nodes.size();
            }

            @Override
            public void drawRow(Canvas c, int i, RectF row, boolean hovered) {
                Library.Node n = nodes.get(i);
                if (n == library.selected) {
                    tmp.set(row);
                    c.drawRoundRect(tmp, 10, 10, Theme.fill(Theme.BUTTON_ON));
                }
                float x = row.left + 8 + n.depth * 22;
                boolean folderish = !Library.isVirtual(n);
                rowText.setColor(Theme.TEXT_DIM);
                rowText.setTextSize(20);
                rowText.setTextAlign(Paint.Align.LEFT);
                Paint.FontMetrics fm = rowText.getFontMetrics();
                if (folderish) c.drawText(n.expanded ? "▾" : "▸", x, row.centerY() - (fm.ascent + fm.descent) / 2f, rowText);
                rowText.setColor(n.error != null ? Theme.WARNING : Theme.TEXT);
                String name = n.loading ? n.name + " …" : n.name;
                LabelFit.draw(c, rowText, name, 0, row.centerY(), row.right - x - 30, new float[] {24, 22, 20}, 1,
                        row.height(), true, x + 22);
            }

            @Override
            public void onClick(int i) {
                library.toggle(nodes.get(i));
            }
        });
        tree.at(pad, 88, 330, height - pad);
        tree.scrollTo(treeScroll);
        widgets.add(tree);

        // right column
        float left = 344, right = width - pad, listBottom = height - 84;
        if (needsAccessCard()) {
            layoutAccessCard(left, 100, right);
            return;
        }
        files = new VirtualList("list.files", 70, new VirtualList.Rows() {
            @Override
            public int count() {
                return library.view.size();
            }

            @Override
            public void drawRow(Canvas c, int i, RectF row, boolean hovered) {
                drawFileRow(c, library.view.get(i), row, i == library.openIndex());
            }

            @Override
            public void onClick(int i) {
                Library.Item it = library.view.get(i);
                if (!it.entry.folder && files.lastX() > files.bounds.right - 70) library.toggleKept(it);
                else library.activate(it);
            }
        });
        files.at(left, 88, right, listBottom);
        files.scrollTo(filesScroll);
        widgets.add(files);
        if (library.view.isEmpty()) {
            String msg = library.selected != null && library.selected.loading ? "읽는 중…"
                    : library.selected != null && library.selected.error != null ? library.selected.error
                    : "볼 수 있는 파일이 없어요";
            widgets.add(new Widgets.Label(msg, Theme.TEXT_DIM, 24, false, false).at(left, 300, right, 350));
        }

        // jumps: top, -100, page up, page down, +100, bottom
        String[] labels = {"⏮", "-100", "▲", "▼", "+100", "⏭"};
        float bw = (right - left - 5 * 8) / 6f;
        for (int k = 0; k < labels.length; k++) {
            final int which = k;
            float x = left + k * (bw + 8);
            widgets.add(new Widgets.Button("list.jump" + k, labels[k], "", () -> jump(which))
                    .at(x, listBottom + 10, x + bw, height - pad));
        }
    }

    private void jump(int which) {
        if (files == null) return;
        float page = files.bounds.height();
        float rows100 = JUMP_ROWS * files.rowHeight;
        switch (which) {
            case 0: files.scrollTo(0); break;
            case 1: files.scrollTo(files.scroll - rows100); break;
            case 2: files.scrollTo(files.scroll - page); break;
            case 3: files.scrollTo(files.scroll + page); break;
            case 4: files.scrollTo(files.scroll + rows100); break;
            default: files.scrollTo(files.maxScroll()); break;
        }
        invalidate();
    }

    /** A source root with nothing in it (not connected, no access): show the source card. */
    private boolean needsAccessCard() {
        Library.Node n = library.selected;
        return n != null && !Library.isVirtual(n) && n.folderId == null && n.loaded && n.children.isEmpty();
    }

    /** Source card (MediaSource.status / hasSetup / openSetup). The device source adds "모든 파일 접근". */
    private void layoutAccessCard(float left, float top, float right) {
        MediaSource src = SourceRegistry.find(library.selected.sourceId);
        if (src == null) return;
        String status = null;
        try {
            status = src.status();
        } catch (RuntimeException e) {
            Log.w("QuestNative", "[ui] status() failed for " + src.id(), e);
        }
        Widgets.Label l1 = new Widgets.Label(status != null ? status : "아직 볼 수 있는 폴더가 없어요", Theme.TEXT, 28, true,
                false);
        widgets.add(l1.at(left, top, right, top + 50));
        Runnable after = () -> UiThread.post(() -> {
            library.refreshRoots();
            library.reload();
        });
        boolean device = src instanceof DeviceSource;
        if (device) {
            Widgets.Label l2 = new Widgets.Label(
                    "폴더 고르기: 고른 폴더만 봅니다(권장).\n모든 파일 접근: 저장소 전체를 봅니다(설정 화면이 열려요).",
                    Theme.TEXT_DIM, 22, false, false);
            l2.maxLines = 2;
            widgets.add(l2.at(left, top + 60, right, top + 130));
        }
        boolean setup = false;
        try {
            setup = src.hasSetup();
        } catch (RuntimeException e) {
            Log.w("QuestNative", "[ui] hasSetup() failed for " + src.id(), e);
        }
        float mid = device ? (left + right) / 2f - 8 : right;
        if (setup) {
            widgets.add(new Widgets.Button("list.setup", device ? "폴더 고르기" : "연결 설정", "", () -> src.openSetup(after))
                    .at(left, top + 160, mid, top + 230));
        }
        if (device) {
            DeviceSource d = (DeviceSource) src;
            widgets.add(new Widgets.Button("list.allFiles", "모든 파일 접근", "", () -> d.requestAllFilesAccess(after))
                    .at((left + right) / 2f + 8, top + 160, right, top + 230));
        }
        if (setup || device) {
            Widgets.Label l3 = new Widgets.Label("헤드셋 화면이 잠시 2D 창으로 바뀌었다가 돌아옵니다.", Theme.TEXT_DIM, 20,
                    false, false);
            widgets.add(l3.at(left, top + 250, right, top + 290));
        }
    }

    private void drawFileRow(Canvas c, Library.Item it, RectF row, boolean open) {
        float x = row.left + 10;
        if (open) {
            tmp.set(row.left, row.top + 8, row.left + 5, row.bottom - 8);
            c.drawRoundRect(tmp, 2, 2, openMark);
        }
        String badge;
        int color;
        if (it.entry.folder) {
            badge = "폴더";
            color = Color.rgb(138, 148, 166);
        } else if (MediaKind.SPLAT.equals(it.kind)) {
            badge = "PLY";
            color = Color.rgb(123, 97, 255);
        } else if (MediaKind.VIDEO.equals(it.kind)) {
            badge = "영상";
            color = Color.rgb(230, 92, 92);
        } else {
            badge = "사진";
            color = Color.rgb(62, 180, 112);
        }
        badgeBg.setColor(color);
        tmp.set(x, row.centerY() - 16, x + 64, row.centerY() + 16);
        c.drawRoundRect(tmp, 8, 8, badgeBg);
        badgeText.setTextAlign(Paint.Align.CENTER);
        Paint.FontMetrics fm = badgeText.getFontMetrics();
        c.drawText(badge, tmp.centerX(), tmp.centerY() - (fm.ascent + fm.descent) / 2f, badgeText);
        float textLeft = x + 80;
        float textRight = row.right - (it.entry.folder ? 10 : 70);
        rowText.setColor(Theme.TEXT);
        LabelFit.draw(c, rowText, it.entry.name, 0, row.top + 24, textRight - textLeft, new float[] {24, 22, 20}, 1,
                30, true, textLeft);
        String meta = meta(it);
        if (!meta.isEmpty()) {
            metaText.setTextAlign(Paint.Align.LEFT);
            c.drawText(meta, textLeft, row.bottom - 12, metaText);
        }
        if (!it.entry.folder) {
            star.setTextAlign(Paint.Align.CENTER);
            Paint.FontMetrics sf = star.getFontMetrics();
            c.drawText(library.isKept(it) ? "★" : "☆", row.right - 35, row.centerY() - (sf.ascent + sf.descent) / 2f,
                    star);
        }
    }

    private String meta(Library.Item it) {
        StringBuilder sb = new StringBuilder();
        if (!it.entry.folder && it.entry.size >= 0) sb.append(size(it.entry.size));
        if (it.entry.modifiedMs > 0) {
            if (sb.length() > 0) sb.append(" · ");
            sb.append(dateFormat.format(new Date(it.entry.modifiedMs)));
        }
        return sb.toString();
    }

    private static String size(long b) {
        if (b < 1024) return b + " B";
        if (b < 1024 * 1024) return String.format(Locale.ROOT, "%.0f KB", b / 1024.0);
        if (b < 1024L * 1024 * 1024) return String.format(Locale.ROOT, "%.1f MB", b / 1048576.0);
        return String.format(Locale.ROOT, "%.2f GB", b / 1073741824.0);
    }
}
