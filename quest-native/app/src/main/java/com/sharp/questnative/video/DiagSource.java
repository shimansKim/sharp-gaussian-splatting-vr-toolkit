package com.sharp.questnative.video;

import com.sharp.questnative.core.MediaEntry;
import com.sharp.questnative.core.MediaSource;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * List-panel entry for the decoder diagnostics: the diagnostics home (opens the video viewer in
 * diagnostics mode) and the test videos in files/diagnostics/tests. Owner: video-dev.
 */
final class DiagSource implements MediaSource {
    @Override
    public String id() {
        return "diag";
    }

    @Override
    public String displayName() {
        return "디코더 진단";
    }

    @Override
    public List<MediaEntry> list(String folderId) {
        List<MediaEntry> out = new ArrayList<>();
        if (folderId != null) return out;
        out.add(new MediaEntry("home", DiagRunner.HOME_NAME, false, "", -1, 0, DiagRunner.HOME_URI));
        File dir = DiagRunner.baseDir() == null ? null : DiagRunner.testsDir();
        String[] names = dir == null ? null : dir.list();
        if (names == null) return out;
        for (String n : DiagTests.pickTestFiles(Arrays.asList(names))) {
            File f = new File(dir, n);
            out.add(new MediaEntry("test:" + n, n, false, "", f.length(), f.lastModified(),
                    "file://" + f.getAbsolutePath()));
        }
        return out;
    }
}
