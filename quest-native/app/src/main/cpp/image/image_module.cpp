// image module stub. Owner: image-dev. Replace the body; keep the QN_REGISTER_MODULE line.
#include "core/qn_api.h"
#include "core/qn_log.h"

namespace {

class ImageViewer final : public qn::Viewer {
public:
    bool Open(const qn::OpenRequest& request, std::string* error) override {
        QN_LOGI("[image] open %s (stub)", request.name.c_str());
        if (error) *error = "image viewer not implemented yet";
        return false;
    }
    void Close() override {}
};

qn::ModuleInfo Info() {
    qn::ModuleInfo info;
    info.id = "image";
    info.kind = qn::ModuleKind::kViewer;
    info.fileExtensions = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".avif", ".gif", ".bmp"};
    info.mimePrefixes = {"image/"};
    info.create = [] { return std::make_unique<ImageViewer>(); };
    return info;
}

}  // namespace

QN_REGISTER_MODULE(Info());
