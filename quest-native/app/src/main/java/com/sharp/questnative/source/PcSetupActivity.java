package com.sharp.questnative.source;

import android.app.Activity;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.sharp.questnative.core.SourceRegistry;

import java.util.Locale;

/**
 * 2D setup screen for the PC source (feature-parity #15: typing the PC address). It opens as a
 * normal Android window, like the system folder picker, so the system keyboard can be used; the
 * headset returns to VR when it closes. Started with QnActivity.startForResult. Owner: encode-guide.
 */
public final class PcSetupActivity extends Activity {
    private final Handler main = new Handler(Looper.getMainLooper());
    private PcSource pc;
    private TextView status;
    private TextView cacheLine;
    private EditText address;
    private Button[] buttons;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        setTitle("PC 연결");
        pc = (PcSource) SourceRegistry.find(PcSource.ID);
        if (pc == null) pc = new PcSource(this);

        int pad = dp(24);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(pad, pad, pad, pad);

        TextView title = text("PC 연결", 26);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        col.addView(title);

        status = text(pc.statusText(), 18);
        status.setPadding(0, dp(12), 0, dp(12));
        col.addView(status);

        col.addView(text("PC에서 run_quest_pc_server.bat을 켜면 PC 창에 주소(예: http://192.168.0.23:8787)가 나옵니다. "
                + "자동으로 찾지 못하면 그 주소를 아래에 입력하세요.", 16));

        address = new EditText(this);
        address.setSingleLine(true);
        address.setHint("192.168.0.23:8787");
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setImeOptions(EditorInfo.IME_ACTION_GO);
        String manual = pc.manualAddress();
        address.setText(manual.startsWith("http://") ? manual.substring(7) : manual);
        address.setOnEditorActionListener((v, actionId, event) -> {
            connectTyped();
            return true;
        });
        col.addView(address, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.END);
        Button connect = button("이 주소로 연결", v -> connectTyped());
        Button search = button("자동으로 찾기", v -> run("PC를 찾는 중…", () -> pc.reconnect()));
        Button done = button("닫기", v -> finish());
        row.addView(search);
        row.addView(connect);
        row.addView(done);
        col.addView(row);

        cacheLine = text("", 14);
        cacheLine.setPadding(0, dp(20), 0, 0);
        col.addView(cacheLine);
        Button clear = button("받아 둔 파일 지우기", v -> {
            pc.cache().clear();
            showCache();
        });
        col.addView(clear);
        buttons = new Button[] {connect, search, done, clear};
        showCache();
        setContentView(col);
    }

    private void connectTyped() {
        String typed = address.getText().toString();
        run("연결하는 중…", () -> pc.setManualAddress(typed));
    }

    /** Runs a blocking PcSource call off the main thread; null result = success. */
    private void run(String busy, java.util.function.Supplier<String> work) {
        status.setText(busy);
        setEnabled(false);
        new Thread(() -> {
            String err = work.get();
            main.post(() -> {
                if (isFinishing()) return;
                setEnabled(true);
                status.setText(err == null ? pc.statusText() : err);
            });
        }, "QnPcSetup").start();
    }

    private void showCache() {
        new Thread(() -> {
            long used = pc.cache().usedBytes();
            main.post(() -> cacheLine.setText(String.format(Locale.ROOT,
                    "사진·PLY는 열 때 헤드셋에 받아 둡니다(지금 %.1f GB). 공간이 모자라면 오래된 것부터 지웁니다.",
                    used / 1073741824.0)));
        }, "QnPcCache").start();
    }

    private void setEnabled(boolean on) {
        for (Button b : buttons) b.setEnabled(on);
        address.setEnabled(on);
    }

    private TextView text(String s, int sp) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        return t;
    }

    private Button button(String label, android.view.View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setOnClickListener(l);
        return b;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
