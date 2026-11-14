// C++20, VK_NO_PROTOTYPES + volk (namespace volk). See splat_engine.h.
#include <volk.h>

#include "splat_engine.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <map>
#include <utility>
#include <vector>

#include "splatcore/pack.h"
#include "splatrender/splat_renderer.h"
#include "splatrender/vk_context.h"
#include "splatrender/vk_timer.h"

#ifdef __ANDROID__
#include <android/log.h>
#endif

namespace qnsplat {

namespace {
void Log(const char* fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
#ifdef __ANDROID__
    __android_log_vprint(ANDROID_LOG_INFO, "QNSplat", fmt, ap);
#else
    std::vfprintf(stderr, fmt, ap);
    std::fputc(0x0A, stderr);
#endif
    va_end(ap);
}
}  // namespace

static_assert(sizeof(EyeCamera) == sizeof(splatrender::SplatCameraParams), "EyeCamera must mirror SplatCameraParams");

bool make_stereo_setup(const EyeTargetDesc eyes[2], const Mat4& worldFromScene, float pointSize, StereoSetup* out,
                       float maxAngleRad) {
    const Quat& a = eyes[0].pose.orientation;
    const Quat& b = eyes[1].pose.orientation;
    const float dot = std::fabs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
    out->angleRad = 2.0f * std::acos(std::min(1.0f, dot));
    if (out->angleRad > maxAngleRad) return false;

    float tl[2], tr[2], tu[2], td[2], fx[2], fy[2];
    for (int e = 0; e < 2; ++e) {
        tl[e] = std::tan(eyes[e].fov.angle_left);
        tr[e] = std::tan(eyes[e].fov.angle_right);
        tu[e] = std::tan(eyes[e].fov.angle_up);
        td[e] = std::tan(eyes[e].fov.angle_down);
        fx[e] = static_cast<float>(eyes[e].extent.width) / (tr[e] - tl[e]);
        fy[e] = static_cast<float>(eyes[e].extent.height) / (tu[e] - td[e]);
    }
    // Union of the two fields of view at the finer of the two pixel pitches (same pixel units as an eye,
    // so the dilation and the sub-pixel culls keep their meaning).
    const float fxc = std::max(fx[0], fx[1]), fyc = std::max(fy[0], fy[1]);
    const float tlc = std::min(tl[0], tl[1]), tuc = std::max(tu[0], tu[1]);
    const float wc = std::ceil(fxc * (std::max(tr[0], tr[1]) - tlc));
    const float hc = std::ceil(fyc * (tuc - std::min(td[0], td[1])));
    Fov fovc;
    fovc.angle_left = std::atan(tlc);
    fovc.angle_right = std::atan(tlc + wc / fxc);
    fovc.angle_up = std::atan(tuc);
    fovc.angle_down = std::atan(tuc - hc / fyc);

    Pose center;
    center.orientation = a;
    center.position = {0.5f * (eyes[0].pose.position.x + eyes[1].pose.position.x),
                       0.5f * (eyes[0].pose.position.y + eyes[1].pose.position.y),
                       0.5f * (eyes[0].pose.position.z + eyes[1].pose.position.z)};
    out->center = make_eye_camera(center, fovc, static_cast<std::uint32_t>(wc), static_cast<std::uint32_t>(hc),
                                  worldFromScene);
    const float fxcExact = out->center.focal_x, fycExact = out->center.focal_y;
    out->center.focal_x *= pointSize;  // covariance only, like the per-eye path
    out->center.focal_y *= pointSize;

    const Mat4 c = mat_from_pose(center);  // columns: right, up, back (world)
    for (int e = 0; e < 2; ++e) {
        const float d[3] = {eyes[e].pose.position.x - center.position.x, eyes[e].pose.position.y - center.position.y,
                            eyes[e].pose.position.z - center.position.z};
        const float dx = d[0] * c.m[0] + d[1] * c.m[1] + d[2] * c.m[2];
        const float dy = d[0] * c.m[4] + d[1] * c.m[5] + d[2] * c.m[6];
        out->viewport[e][0] = static_cast<float>(eyes[e].extent.width);
        out->viewport[e][1] = static_cast<float>(eyes[e].extent.height);
        out->pxScale[e][0] = fx[e] / fxcExact;
        out->pxScale[e][1] = fy[e] / fycExact;
        // px_eye = fx_e * (tan_x - tl_e) with tan_x = tlc + px / fxc - dx / depth (y: fy_e * (tu_e - tan_y)).
        out->pxOffset[e][0] = fx[e] * (tlc - tl[e]);
        out->pxOffset[e][1] = fy[e] * (tu[e] - tuc);
        out->parallax[e][0] = -fx[e] * dx;
        out->parallax[e][1] = fy[e] * dy;
    }
    out->eyePixels = static_cast<float>(eyes[0].extent.width) * static_cast<float>(eyes[0].extent.height);
    return true;
}

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
    bool stereoShared = true;
    bool stereoWarned = false;
    bool stereoLogged = false;
    int drawMode = static_cast<int>(splatrender::SplatRenderer::kDefaultDrawMode);
    bool halfFragment = false;
    float alphaCutLsb = 1.0f;
    float supportR2 = 8.0f, maxPx = 2048.0f;
    int drawProbe = 0;

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
        for (int e = 0; e < (stereoShared ? 1 : 2); ++e) {  // shared: one renderer, one copy of the scene
            auto& r = eyes[e];
            r.set_fragment_density_map(fdmAttach);
            auto s = r.init(ctx, *pack, VK_FORMAT_R8G8B8A8_UNORM);
            if (!s) {
                if (error) *error = s.error();
                for (auto& rr : eyes) rr.destroy();
                return false;
            }
            ApplySettings(r);
        }
        hasScene = true;
        return true;
    }

    void ApplySettings(splatrender::SplatRenderer& r) {
        r.set_key_bits(keyBits);
        r.set_min_contribution(minContribution);
        r.set_draw_mode(static_cast<splatrender::SplatRenderer::DrawMode>(drawMode));
        r.set_half_fragment(halfFragment);
        r.set_alpha_cut(alphaCutLsb / 255.0f);
        r.set_support(supportR2, maxPx);
        (void)r.set_draw_probe(static_cast<splatrender::SplatRenderer::DrawProbe>(drawProbe));
    }

    int RendererCount() const { return stereoShared ? 1 : 2; }

    void BeginEyePass(VkCommandBuffer cmd, const EyeTargetDesc& t) {
        const VkImageView color = ViewFor(colorViews, t.image, t.arrayLayer, VK_FORMAT_R8G8B8A8_UNORM);
        VkRenderingAttachmentInfo att{};
        att.sType = VK_STRUCTURE_TYPE_RENDERING_ATTACHMENT_INFO;
        att.imageView = color;
        att.imageLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
        att.loadOp = t.clear ? VK_ATTACHMENT_LOAD_OP_CLEAR : VK_ATTACHMENT_LOAD_OP_LOAD;  // core already cleared
        att.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
        std::memcpy(att.clearValue.color.float32, t.clearColor, sizeof(t.clearColor));
        VkRenderingInfo ri{};
        ri.sType = VK_STRUCTURE_TYPE_RENDERING_INFO;
        ri.renderArea = {{0, 0}, t.extent};
        ri.layerCount = 1;
        ri.colorAttachmentCount = 1;
        ri.pColorAttachments = &att;
        VkRenderingFragmentDensityMapAttachmentInfoEXT fdm{};
        if (fdmAttach && t.fdmImage != VK_NULL_HANDLE) {
            const VkImageView fdmView = ViewFor(fdmViews, t.fdmImage, t.arrayLayer, VK_FORMAT_R8G8_UNORM);
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

bool SplatEngine::SetStereoShared(bool on, std::string* error) {
    if (on == impl_->stereoShared) return true;
    impl_->stereoShared = on;
    impl_->stereoWarned = false;
    return impl_->InitRenderers(error);
}

bool SplatEngine::StereoShared() const { return impl_->stereoShared; }

void SplatEngine::SetDrawMode(int mode) {
    impl_->drawMode = std::min(3, std::max(0, mode));
    for (auto& r : impl_->eyes) r.set_draw_mode(static_cast<splatrender::SplatRenderer::DrawMode>(impl_->drawMode));
}

int SplatEngine::DrawMode() const { return impl_->drawMode; }

void SplatEngine::SetHalfFragment(bool on) {
    impl_->halfFragment = on;
    for (auto& r : impl_->eyes) r.set_half_fragment(on);
}

bool SplatEngine::HalfFragment() const { return impl_->halfFragment; }

void SplatEngine::SetAlphaCut(float lsb) {
    impl_->alphaCutLsb = std::min(64.0f, std::max(1.0f, lsb));
    for (auto& r : impl_->eyes) r.set_alpha_cut(impl_->alphaCutLsb / 255.0f);
}

float SplatEngine::AlphaCut() const { return impl_->alphaCutLsb; }

void SplatEngine::SetSupport(float r2, float maxPx) {
    impl_->supportR2 = std::min(8.0f, std::max(1.0f, r2));
    impl_->maxPx = std::min(2048.0f, std::max(4.0f, maxPx));
    for (auto& r : impl_->eyes) r.set_support(impl_->supportR2, impl_->maxPx);
}

float SplatEngine::SupportR2() const { return impl_->supportR2; }
float SplatEngine::MaxPixelRadius() const { return impl_->maxPx; }

void SplatEngine::SetDrawProbe(int probe) {
    impl_->drawProbe = std::min(6, std::max(0, probe));
    if (!impl_->hasScene) return;
    for (int e = 0; e < impl_->RendererCount(); ++e)
        (void)impl_->eyes[e].set_draw_probe(static_cast<splatrender::SplatRenderer::DrawProbe>(impl_->drawProbe));
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
    for (int e = 0; e < 2; ++e)
        if (m.ViewFor(m.colorViews, eyes[e].image, eyes[e].arrayLayer, VK_FORMAT_R8G8B8A8_UNORM) == VK_NULL_HANDLE) return;

    StereoSetup st;
    if (m.stereoShared && !make_stereo_setup(eyes, worldFromScene, m.pointSize, &st)) {
        // Not parallel eyes: the shared camera would be wrong. Fall back to per-eye compute for good.
        if (!m.stereoWarned) {
            Log("qnsplat: eyes %.3f deg apart, shared stereo sort off", st.angleRad * 57.29578f);
            m.stereoWarned = true;
        }
        m.stereoShared = false;
        if (!m.InitRenderers(nullptr)) return;
    }

    if (m.stereoShared && !m.stereoLogged) {  // once: what the device's views look like
        Log("qnsplat: shared stereo sort: eyes %.4f deg apart, record camera %.0fx%.0f, parallax x %.1f / %.1f px*m, "
            "offset x %.1f / %.1f px",
            st.angleRad * 57.29578f, st.center.viewport_w, st.center.viewport_h, st.parallax[0][0], st.parallax[1][0],
            st.pxOffset[0][0], st.pxOffset[1][0]);
        m.stereoLogged = true;
    }
    if (m.timerOk) m.timer.begin_frame(cmd, slot);
    if (m.stereoShared) {
        splatrender::SplatRenderer& r = m.eyes[0];
        splatrender::SplatCameraParams params;
        std::memcpy(&params, &st.center, sizeof(params));
        r.set_contribution_pixels(st.eyePixels);
        r.prepare_frame(slot, params);
        r.record_compute(cmd, slot, m.timerOk ? &m.timer : nullptr);  // stamps 1, 2: chunk cull, preprocess done
        if (m.timerOk) m.timer.stamp(cmd, slot);                        // 3: sort done
        for (int e = 0; e < 2; ++e) {
            splatrender::SplatRenderer::DrawView v;
            for (int i = 0; i < 2; ++i) {
                v.viewport[i] = st.viewport[e][i];
                v.px_scale[i] = st.pxScale[e][i];
                v.px_offset[i] = st.pxOffset[e][i];
                v.parallax[i] = st.parallax[e][i];
            }
            m.BeginEyePass(cmd, eyes[e]);
            r.record_draw(cmd, slot, &v);
            vkCmdEndRendering(cmd);
            if (m.timerOk && e == 0) m.timer.stamp(cmd, slot);  // 4: left draw done
        }
    } else {
        for (int e = 0; e < 2; ++e) {
            const EyeTargetDesc& t = eyes[e];
            EyeCamera cam = make_eye_camera(t.pose, t.fov, t.extent.width, t.extent.height, worldFromScene);
            cam.focal_x *= m.pointSize;  // projection of the centers (proj_view) is unchanged
            cam.focal_y *= m.pointSize;
            splatrender::SplatCameraParams params;
            std::memcpy(&params, &cam, sizeof(params));
            m.eyes[e].set_contribution_pixels(0.0f);
            m.eyes[e].prepare_frame(slot, params);
            m.eyes[e].record_compute(cmd, slot, nullptr);
            if (m.timerOk) m.timer.stamp(cmd, slot);  // 1 / 3: compute done
            m.BeginEyePass(cmd, t);
            m.eyes[e].record_draw(cmd, slot);
            vkCmdEndRendering(cmd);
            if (m.timerOk && e == 0) m.timer.stamp(cmd, slot);  // 2: left draw done
        }
    }
    if (m.timerOk) m.timer.end_frame(cmd, slot);  // last: right draw done
    const bool sharedTiming = m.stereoShared;

    if (out) {
        out->cpu_ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - c0).count();
        if (m.timerOk) {
            out->gpu_ms = m.timer.last_gpu_ms();
            if (sharedTiming && m.timer.segment_count() == 5) {
                // shared: lc = chunk cull + preprocess, rc = prepare + sort (both for both eyes)
                out->lc = m.timer.segment_ms(0) + m.timer.segment_ms(1);
                out->rc = m.timer.segment_ms(2);
                out->ld = m.timer.segment_ms(3);
                out->rd = m.timer.segment_ms(4);
            } else {
                out->lc = m.timer.segment_ms(0);
                out->ld = m.timer.segment_ms(1);
                out->rc = m.timer.segment_ms(2);
                out->rd = m.timer.segment_ms(3);
            }
        }
        out->vis_l = m.eyes[0].last_visible_count();
        out->vis_r = m.stereoShared ? out->vis_l : m.eyes[1].last_visible_count();
    }
}

}  // namespace qnsplat
