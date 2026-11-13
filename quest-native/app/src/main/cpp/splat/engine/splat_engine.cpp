// C++20, VK_NO_PROTOTYPES + volk (namespace volk). See splat_engine.h.
#include <volk.h>

#include "splat_engine.h"

#include <algorithm>
#include <chrono>
#include <cstring>
#include <map>
#include <utility>
#include <vector>

#include "splatcore/pack.h"
#include "splatrender/splat_renderer.h"
#include "splatrender/vk_context.h"
#include "splatrender/vk_timer.h"

namespace qnsplat {

static_assert(sizeof(EyeCamera) == sizeof(splatrender::SplatCameraParams), "EyeCamera must mirror SplatCameraParams");

struct SplatEngine::Impl {
    EngineGpu gpu;
    splatrender::Context ctx;
    splatrender::SplatRenderer eyes[2];
    splatrender::GpuTimer timer;
    bool timerOk = false;
    bool hasScene = false;
    std::unique_ptr<splatcore::GpuPack> pack;  // kept to rebuild pipelines (foveation toggle)
    int keyBits = 16;
    bool fdmAttach = false;
    float pointSize = 1.0f;
    float minContribution = 0.0f;

    using Key = std::pair<VkImage, std::uint32_t>;
    std::map<Key, VkImageView> colorViews;
    std::map<Key, VkImageView> fdmViews;
    struct Retired {
        VkImageView view;
        int framesLeft;
    };
    std::vector<Retired> retired;

    VkImageView ViewFor(std::map<Key, VkImageView>& cache, VkImage image, std::uint32_t layer, VkFormat format) {
        const Key key{image, layer};
        auto it = cache.find(key);
        if (it != cache.end()) return it->second;
        VkImageViewCreateInfo vi{};
        vi.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
        vi.image = image;
        vi.viewType = VK_IMAGE_VIEW_TYPE_2D;
        vi.format = format;
        vi.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, layer, 1};
        VkImageView view = VK_NULL_HANDLE;
        if (vkCreateImageView(ctx.device(), &vi, nullptr, &view) != VK_SUCCESS) return VK_NULL_HANDLE;
        cache.emplace(key, view);
        return view;
    }

    void RetireAll() {
        for (auto& kv : colorViews) retired.push_back({kv.second, 3});
        for (auto& kv : fdmViews) retired.push_back({kv.second, 3});
        colorViews.clear();
        fdmViews.clear();
    }

    void TickRetired() {
        for (auto it = retired.begin(); it != retired.end();) {
            if (--it->framesLeft <= 0) {
                vkDestroyImageView(ctx.device(), it->view, nullptr);
                it = retired.erase(it);
            } else {
                ++it;
            }
        }
    }

    bool InitRenderers(std::string* error) {
        ctx.wait_idle();
        for (auto& r : eyes) r.destroy();
        hasScene = false;
        if (!pack) return true;
        for (auto& r : eyes) {
            r.set_fragment_density_map(fdmAttach);
            auto s = r.init(ctx, *pack, VK_FORMAT_R8G8B8A8_UNORM);
            if (!s) {
                if (error) *error = s.error();
                for (auto& rr : eyes) rr.destroy();
                return false;
            }
            r.set_key_bits(keyBits);
            r.set_min_contribution(minContribution);
        }
        hasScene = true;
        return true;
    }
};

SplatEngine::SplatEngine() : impl_(new Impl) {}

SplatEngine::~SplatEngine() {
    if (!impl_) return;
    impl_->ctx.wait_idle();
    for (auto& r : impl_->eyes) r.destroy();
    impl_->timer.destroy();
    impl_->RetireAll();
    for (auto& r : impl_->retired) vkDestroyImageView(impl_->ctx.device(), r.view, nullptr);
    impl_->retired.clear();
    impl_->ctx.destroy();  // borrowed handles: frees only VMA
}

std::unique_ptr<SplatEngine> SplatEngine::Create(const EngineGpu& gpu, std::string* error) {
    std::unique_ptr<SplatEngine> engine(new SplatEngine());
    Impl& m = *engine->impl_;
    m.gpu = gpu;
    splatrender::ExternalHandles h;
    h.instance = gpu.instance;
    h.physical_device = gpu.physicalDevice;
    h.device = gpu.device;
    h.queue = gpu.queue;
    h.queue_family = gpu.queueFamily;
    h.get_instance_proc_addr = gpu.getInstanceProcAddr;
    auto s = m.ctx.init_external(h);
    if (!s) {
        if (error) *error = s.error();
        return nullptr;
    }
    m.timerOk = static_cast<bool>(m.timer.init(m.ctx));
    return engine;
}

bool SplatEngine::SetScene(const splatcore::GpuPack& pack, std::string* error) {
    impl_->pack = std::make_unique<splatcore::GpuPack>(pack);
    return impl_->InitRenderers(error);
}

void SplatEngine::ClearScene() {
    impl_->pack.reset();
    impl_->InitRenderers(nullptr);
}

bool SplatEngine::HasScene() const { return impl_->hasScene; }

void SplatEngine::SetKeyBits(int bits) {
    impl_->keyBits = bits == 32 ? 32 : 16;
    for (auto& r : impl_->eyes) r.set_key_bits(impl_->keyBits);
}

int SplatEngine::KeyBits() const { return impl_->keyBits; }

void SplatEngine::SetPointSize(float scale) { impl_->pointSize = std::min(2.0f, std::max(0.5f, scale)); }

float SplatEngine::PointSize() const { return impl_->pointSize; }

void SplatEngine::SetMinContribution(float pixels) {
    impl_->minContribution = std::max(0.0f, pixels);
    for (auto& r : impl_->eyes) r.set_min_contribution(impl_->minContribution);
}

bool SplatEngine::SetFoveationAttachment(bool on, std::string* error) {
    if (on && !impl_->gpu.fragmentDensityMapEnabled) {
        if (error) *error = "VK_EXT_fragment_density_map not enabled on this device";
        return false;
    }
    if (on == impl_->fdmAttach) return true;
    impl_->fdmAttach = on;
    return impl_->InitRenderers(error);
}

bool SplatEngine::FoveationAttachment() const { return impl_->fdmAttach; }

void SplatEngine::ForgetTargets() { impl_->RetireAll(); }

std::string SplatEngine::DeviceName() const { return impl_->ctx.device_name(); }

void SplatEngine::Record(VkCommandBuffer cmd, std::uint32_t slot, const EyeTargetDesc eyes[2], const Mat4& worldFromScene,
                         FrameSample* out) {
    Impl& m = *impl_;
    m.TickRetired();
    if (!m.hasScene) return;
    const auto c0 = std::chrono::steady_clock::now();
    if (m.timerOk) m.timer.begin_frame(cmd, slot);
    for (int e = 0; e < 2; ++e) {
        const EyeTargetDesc& t = eyes[e];
        EyeCamera cam = make_eye_camera(t.pose, t.fov, t.extent.width, t.extent.height, worldFromScene);
        cam.focal_x *= m.pointSize;  // projection of the centers (proj_view) is unchanged
        cam.focal_y *= m.pointSize;
        splatrender::SplatCameraParams params;
        std::memcpy(&params, &cam, sizeof(params));
        m.eyes[e].prepare_frame(slot, params);
        m.eyes[e].record_compute(cmd, slot, nullptr);
        if (m.timerOk) m.timer.stamp(cmd, slot);  // 1 / 3: compute done

        const VkImageView color = m.ViewFor(m.colorViews, t.image, t.arrayLayer, VK_FORMAT_R8G8B8A8_UNORM);
        if (color == VK_NULL_HANDLE) continue;
        VkRenderingAttachmentInfo att{};
        att.sType = VK_STRUCTURE_TYPE_RENDERING_ATTACHMENT_INFO;
        att.imageView = color;
        att.imageLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
        att.loadOp = VK_ATTACHMENT_LOAD_OP_LOAD;  // core already cleared
        att.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
        VkRenderingInfo ri{};
        ri.sType = VK_STRUCTURE_TYPE_RENDERING_INFO;
        ri.renderArea = {{0, 0}, t.extent};
        ri.layerCount = 1;
        ri.colorAttachmentCount = 1;
        ri.pColorAttachments = &att;
        VkRenderingFragmentDensityMapAttachmentInfoEXT fdm{};
        if (m.fdmAttach && t.fdmImage != VK_NULL_HANDLE) {
            const VkImageView fdmView = m.ViewFor(m.fdmViews, t.fdmImage, t.arrayLayer, VK_FORMAT_R8G8_UNORM);
            if (fdmView != VK_NULL_HANDLE) {
                fdm.sType = VK_STRUCTURE_TYPE_RENDERING_FRAGMENT_DENSITY_MAP_ATTACHMENT_INFO_EXT;
                fdm.imageView = fdmView;
                fdm.imageLayout = VK_IMAGE_LAYOUT_FRAGMENT_DENSITY_MAP_OPTIMAL_EXT;
                ri.pNext = &fdm;
            }
        }
        vkCmdBeginRendering(cmd, &ri);
        const VkViewport vp{0.0f, 0.0f, static_cast<float>(t.extent.width), static_cast<float>(t.extent.height), 0.0f, 1.0f};
        const VkRect2D sc{{0, 0}, t.extent};
        vkCmdSetViewport(cmd, 0, 1, &vp);
        vkCmdSetScissor(cmd, 0, 1, &sc);
        m.eyes[e].record_draw(cmd, slot);
        vkCmdEndRendering(cmd);
        if (m.timerOk && e == 0) m.timer.stamp(cmd, slot);  // 2: left draw done
    }
    if (m.timerOk) m.timer.end_frame(cmd, slot);  // 4: right draw done

    if (out) {
        out->cpu_ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - c0).count();
        if (m.timerOk) {
            out->gpu_ms = m.timer.last_gpu_ms();
            out->lc = m.timer.segment_ms(0);
            out->ld = m.timer.segment_ms(1);
            out->rc = m.timer.segment_ms(2);
            out->rd = m.timer.segment_ms(3);
        }
        out->vis_l = m.eyes[0].last_visible_count();
        out->vis_r = m.eyes[1].last_visible_count();
    }
}

}  // namespace qnsplat
