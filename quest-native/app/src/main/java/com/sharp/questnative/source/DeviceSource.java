package com.sharp.questnative.source;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.Settings;
import android.util.Log;

import com.sharp.questnative.core.MediaEntry;
import com.sharp.questnative.core.MediaSource;
import com.sharp.questnative.core.QnActivity;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * Files on the headset. Two ways in (docs/storage-access.md):
 * <ul>
 *   <li>Folders the user picked with the system folder picker (Storage Access Framework). The grant
 *       is persisted, needs no special permission and passes store review as-is.</li>
 *   <li>"All files access" (MANAGE_EXTERNAL_STORAGE): browse the whole shared storage like a file
 *       manager. Meta allows it after review ("file management features").</li>
 * </ul>
 * Folder ids: null = roots, "file:&lt;absolute path&gt;", "tree:&lt;tree uri&gt;|&lt;document id&gt;".
 * Owner: ui (device storage); PC and Google Drive sources belong to encode-guide.
 */
public final class DeviceSource implements MediaSource {
    public static final String ID = "device";
    private static final String TAG = "QuestNative";
    private static final String PREFS = "device_source";

    private final Context context;

    public DeviceSource(Context context) {
        this.context = context.getApplicationContext();
    }

    @Override
    public String id() {
        return ID;
    }

    @Override
    public String displayName() {
        return "이 기기";
    }

    // ---------------------------------------------------------------- access

    public static boolean hasAllFilesAccess() {
        return Environment.isExternalStorageManager();
    }

    /** Persisted folder grants from the system folder picker. */
    public List<Uri> pickedFolders() {
        List<Uri> out = new ArrayList<>();
        for (UriPermission p : context.getContentResolver().getPersistedUriPermissions()) {
            if (p.isReadPermission() && DocumentsContract.isTreeUri(p.getUri())) out.add(p.getUri());
        }
        return out;
    }

    /** Opens the system folder picker; the chosen folder is kept across restarts. */
    public void pickFolder(Runnable done) {
        QnActivity a = QnActivity.current();
        if (a == null) return;
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        a.startForResult(i, (code, data) -> {
            if (data != null && data.getData() != null) {
                try {
                    context.getContentResolver().takePersistableUriPermission(data.getData(),
                            Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    Log.i(TAG, "[source] folder granted " + data.getData());
                } catch (SecurityException e) {
                    Log.w(TAG, "[source] could not persist folder grant", e);
                }
            }
            if (done != null) done.run();
        });
    }

    public void forgetFolder(Uri tree) {
        try {
            context.getContentResolver().releasePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException e) {
            Log.w(TAG, "[source] release failed", e);
        }
    }

    /** Opens Settings > "All files access" for this app. */
    public void requestAllFilesAccess(Runnable done) {
        QnActivity a = QnActivity.current();
        if (a == null) return;
        Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                Uri.parse("package:" + context.getPackageName()));
        a.startForResult(i, (code, data) -> {
            if (done != null) done.run();
        });
    }

    // ---------------------------------------------------------------- listing

    @Override
    public List<MediaEntry> list(String folderId) throws IOException {
        if (folderId == null) return roots();
        if (folderId.startsWith("file:")) return listFiles(new File(folderId.substring(5)));
        if (folderId.startsWith("tree:")) return listTree(folderId.substring(5));
        throw new IOException("unknown folder id " + folderId);
    }

    private List<MediaEntry> roots() {
        List<MediaEntry> out = new ArrayList<>();
        if (hasAllFilesAccess()) {
            File root = Environment.getExternalStorageDirectory();
            out.add(folder("file:" + root.getAbsolutePath(), "내장 저장소", root.lastModified()));
        }
        for (Uri tree : pickedFolders()) {
            String docId = DocumentsContract.getTreeDocumentId(tree);
            out.add(folder("tree:" + tree + "|" + docId, treeName(docId), 0));
        }
        return out;
    }

    private static String treeName(String docId) {
        // "primary:Download/SHARP" -> "SHARP"; "primary:" -> "내장 저장소"
        String path = docId.contains(":") ? docId.substring(docId.indexOf(':') + 1) : docId;
        if (path.isEmpty()) return "내장 저장소";
        int slash = path.lastIndexOf('/');
        return slash < 0 ? path : path.substring(slash + 1);
    }

    private static MediaEntry folder(String id, String name, long mtime) {
        return new MediaEntry(id, name, true, null, -1, mtime, null);
    }

    private static List<MediaEntry> listFiles(File dir) throws IOException {
        File[] files = dir.listFiles();
        if (files == null) throw new IOException("cannot read " + dir);
        List<MediaEntry> out = new ArrayList<>();
        for (File f : files) {
            if (f.getName().startsWith(".")) continue;
            if (f.isDirectory()) {
                out.add(folder("file:" + f.getAbsolutePath(), f.getName(), f.lastModified()));
            } else {
                out.add(new MediaEntry("file:" + f.getAbsolutePath(), f.getName(), false, null, f.length(),
                        f.lastModified(), Uri.fromFile(f).toString()));
            }
        }
        return out;
    }

    private List<MediaEntry> listTree(String spec) throws IOException {
        int bar = spec.lastIndexOf('|');
        if (bar < 0) throw new IOException("bad tree id " + spec);
        Uri tree = Uri.parse(spec.substring(0, bar));
        String docId = spec.substring(bar + 1);
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
        String[] cols = {DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED};
        List<MediaEntry> out = new ArrayList<>();
        ContentResolver cr = context.getContentResolver();
        try (Cursor c = cr.query(children, cols, null, null, null)) {
            if (c == null) throw new IOException("cannot read " + tree);
            while (c.moveToNext()) {
                String id = c.getString(0);
                String name = c.getString(1);
                String mime = c.getString(2);
                long size = c.isNull(3) ? -1 : c.getLong(3);
                long mtime = c.isNull(4) ? 0 : c.getLong(4);
                if (name == null || name.startsWith(".")) continue;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    out.add(folder("tree:" + tree + "|" + id, name, mtime));
                } else {
                    Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, id);
                    out.add(new MediaEntry("tree:" + tree + "|" + id, name, false, mime, size, mtime, doc.toString()));
                }
            }
        } catch (SecurityException e) {
            throw new IOException("folder permission was revoked: " + tree, e);
        }
        return out;
    }

    @Override
    public int openFd(MediaEntry entry) throws IOException {
        if (entry.uri == null) return -1;
        Uri uri = Uri.parse(entry.uri);
        ParcelFileDescriptor pfd;
        if ("file".equals(uri.getScheme())) {
            pfd = ParcelFileDescriptor.open(new File(uri.getPath()), ParcelFileDescriptor.MODE_READ_ONLY);
        } else {
            pfd = context.getContentResolver().openFileDescriptor(uri, "r");
        }
        if (pfd == null) return -1;
        return pfd.detachFd();
    }

    @Override
    public String status() {
        return "기기 파일을 보려면 접근을 허용하세요";
    }

    /** Setup = the system folder picker (store-safe default). "All files access" is an extra card button. */
    @Override
    public boolean hasSetup() {
        return true;
    }

    @Override
    public void openSetup(Runnable done) {
        pickFolder(done);
    }

    SharedPreferences prefs() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
