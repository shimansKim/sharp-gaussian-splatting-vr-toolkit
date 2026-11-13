// NativeActivity entry point. Owner: foundation.
#include <android_native_app_glue.h>

#include "core/app.h"

void android_main(android_app* app) {
    qn::App(app).Run();
}
