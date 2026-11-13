package com.sharp.questnative.ui;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import com.sharp.questnative.core.QnActivity;

/**
 * Privacy / support / terms pages (port of quest-app core/policy-links.js; the pages live on the
 * user site sharp-quest/, deployed from store-site). Opened in the system browser (a 2D window on
 * Quest, like the folder picker); the address is also shown as a toast in case no browser opens.
 * Owner: ui.
 */
final class PolicyLinks {
    static final String[] LABELS = {"개인정보처리방침", "지원", "이용약관"};
    static final String[] URLS = {
        "https://shimanskim.github.io/sharp-quest/privacy/",
        "https://shimanskim.github.io/sharp-quest/support/",
        "https://shimanskim.github.io/sharp-quest/terms/",
    };

    private PolicyLinks() {}

    static void open(int i) {
        String url = URLS[i];
        UiBridge.showToast(url, 6);
        QnActivity a = QnActivity.current();
        if (a == null) return;
        a.runOnUiThread(() -> {
            try {
                a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (ActivityNotFoundException e) {
                Log.w("QuestNative", "[ui] no browser for " + url, e);
            }
        });
    }
}
