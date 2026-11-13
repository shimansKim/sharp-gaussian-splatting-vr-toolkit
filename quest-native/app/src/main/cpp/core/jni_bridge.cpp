// Java -> native calls of com.sharp.questnative.core.NativeBridge. Owner: foundation.
// Calls arrive on Java threads; work is posted to the render thread.
#include <jni.h>

#include <functional>
#include <string>

#include "core/qn_api.h"
#include "core/qn_log.h"

namespace qn {
bool PostIfRunning(std::function<void()> fn);  // core/app.cpp
}

namespace {
std::string ToString(JNIEnv* env, jstring s) {
    if (!s) return {};
    const char* c = env->GetStringUTFChars(s, nullptr);
    std::string out(c ? c : "");
    if (c) env->ReleaseStringUTFChars(s, c);
    return out;
}
}  // namespace

extern "C" JNIEXPORT jboolean JNICALL Java_com_sharp_questnative_core_NativeBridge_nativeOpenMedia(
    JNIEnv* env, jclass, jstring uri, jstring name, jstring mime, jstring sourceId, jstring layoutHint, jint fd,
    jlong size) {
    qn::OpenRequest req;
    req.uri = ToString(env, uri);
    req.name = ToString(env, name);
    req.mimeType = ToString(env, mime);
    req.sourceId = ToString(env, sourceId);
    req.layoutHint = ToString(env, layoutHint);
    req.fd = fd;
    req.size = size;
    bool posted = qn::PostIfRunning([req]() {
        std::string err;
        qn::GetHost().OpenMedia(req, &err);
    });
    if (!posted) QN_LOGW("[core] openMedia before native start, dropped: %s", req.name.c_str());
    return posted ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL Java_com_sharp_questnative_core_NativeBridge_nativeCloseMedia(JNIEnv*, jclass) {
    qn::PostIfRunning([]() { qn::GetHost().CloseMedia(); });
}
