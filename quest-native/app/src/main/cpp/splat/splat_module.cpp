// splat module stub. Owner: splat-dev. Replace the body; keep the QN_REGISTER_MODULE line.
#include "core/qn_api.h"
#include "core/qn_log.h"

namespace {

class SplatViewer final : public qn::Viewer {
public:
    bool Open(const qn::OpenRequest& request, std::string* error) override {
        QN_LOGI("[splat] open %s (stub)", request.name.c_str());
        if (error) *error = "splat viewer not implemented yet";
        return false;
    }
    void Close() override {}
};

// Vulkan 1.3 features the pocketsplat core needs. Core masks anything the device lacks.
void FillDeviceFeatures(VkPhysicalDevice, const qn::DeviceFeatures& supported, qn::DeviceFeatures& requested) {
    if (supported.hasV12) requested.v12.timelineSemaphore = VK_TRUE;
    if (supported.hasV13) {
        requested.v13.dynamicRendering = VK_TRUE;
        requested.v13.synchronization2 = VK_TRUE;
        requested.v13.shaderDemoteToHelperInvocation = VK_TRUE;
        requested.v13.maintenance4 = VK_TRUE;
        requested.v13.subgroupSizeControl = VK_TRUE;
        requested.v13.computeFullSubgroups = VK_TRUE;
    }
}

qn::ModuleInfo Info() {
    qn::ModuleInfo info;
    info.id = "splat";
    info.kind = qn::ModuleKind::kViewer;
    info.fileExtensions = {".ply", ".spz", ".splat"};
    info.fillDeviceFeatures = FillDeviceFeatures;
    info.create = [] { return std::make_unique<SplatViewer>(); };
    return info;
}

}  // namespace

QN_REGISTER_MODULE(Info());
