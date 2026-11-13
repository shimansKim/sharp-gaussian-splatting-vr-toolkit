package com.sharp.questnative.ui;

import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;

import com.sharp.questnative.core.MediaSource;
import com.sharp.questnative.core.SourceRegistry;

import java.util.List;

/**
 * Shared list panel. This PR only lists the registered sources (placeholder); folder tree, file
 * list and settings pages land in the next ui PR. Owner: ui.
 */
final class ListPanel extends Panel {
    private List<MediaSource> sources = SourceRegistry.all();
    private final Paint rowText = Theme.text(Theme.TEXT, 28, false);

    @Override
    void onVisibility(boolean v) {
        if (v) {
            sources = SourceRegistry.all();
            relayout();
        }
    }

    @Override
    void layout() {
        float pad = 24;
        widgets.add(new Widgets.Label("파일", Theme.TEXT, 34, true, true).at(pad, 16, width - 100, 76));
        widgets.add(new Widgets.Button("ui.listClose", "", "close", () -> UiBridge.nativeCommand("list.close", 0))
                .at(width - 80, 16, width - 20, 76));
        if (sources.isEmpty()) {
            widgets.add(new Widgets.Label("등록된 파일 출처가 없어요", Theme.TEXT_DIM, 26, false, false)
                    .at(pad, 300, width - pad, 360));
            return;
        }
        widgets.add(new VirtualList("ui.sources", 72, new VirtualList.Rows() {
            @Override
            public int count() {
                return sources.size();
            }

            @Override
            public void drawRow(Canvas c, int index, RectF row, boolean hovered) {
                LabelFit.draw(c, rowText, sources.get(index).displayName(), 0, row.centerY(), row.width() - 32,
                        new float[] {28, 26, 24}, 1, row.height(), true, row.left + 16);
            }

            @Override
            public void onClick(int index) {
                UiBridge.showToast("폴더 탐색은 다음 단계에서 들어와요", 3);
            }
        }).at(pad, 96, width - pad, height - 24));
    }
}
