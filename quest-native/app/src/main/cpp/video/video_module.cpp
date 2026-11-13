// video module stub. Owner: video-dev. Replace the body; keep the QN_REGISTER_MODULE line.
// Planned path: Host::CreateSurfaceSwapchain -> Surface to Java (com.sharp.questnative.video)
// -> Media3 ExoPlayer; SubmitLayers adds quad / equirect2 / cylinder layers.
#include "core/qn_api.h"
#include "core/qn_log.h"

namespace {

class VideoViewer final : public qn::Viewer {
public:
    bool Open(const qn::OpenRequest& request, std::string* error) override {
        QN_LOGI("[video] open %s (stub)", request.name.c_str());
        if (error) *error = "video viewer not implemented yet";
        return false;
    }
    void Close() override {}
};

qn::ModuleInfo Info() {
    qn::ModuleInfo info;
    info.id = "video";
    info.kind = qn::ModuleKind::kViewer;
    info.fileExtensions = {".mp4", ".m4v", ".mkv", ".webm", ".mov"};
    info.mimePrefixes = {"video/"};
    info.optionalXrExtensions = {XR_FB_ANDROID_SURFACE_SWAPCHAIN_CREATE_EXTENSION_NAME};
    info.create = [] { return std::make_unique<VideoViewer>(); };
    return info;
}

}  // namespace

QN_REGISTER_MODULE(Info());
