#pragma once
// splat engine facade: the only engine header splat_module.cpp (C++17, libvulkan prototypes) includes.
// Everything behind it (pocketsplat, volk, VMA) is C++20 with VK_NO_PROTOTYPES. Only Vulkan handle
// types cross this boundary, so the two Vulkan header setups never meet in one translation unit.
//
// Threading: every call on the render thread (it records on and submits to the core queue).

#include <vulkan/vulkan_core.h>

#include <cstdint>
#include <memory>
#include <string>

#include "frame_log.h"
#include "xr_camera.h"

namespace splatcore {
struct GpuPack;
}

namespace qnsplat {

struct EngineGpu {
    VkInstance instance = VK_NULL_HANDLE;
    VkPhysicalDevice physicalDevice = VK_NULL_HANDLE;
    VkDevice device = VK_NULL_HANDLE;
    VkQueue queue = VK_NULL_HANDLE;
    std::uint32_t queueFamily = 0;
    PFN_vkGetInstanceProcAddr getInstanceProcAddr = nullptr;
    bool fragmentDensityMapEnabled = false;  // VK_EXT_fragment_density_map enabled + feature on
};

/** One eye of the projection swapchain for this frame. */
struct EyeTargetDesc {
    VkImage image = VK_NULL_HANDLE;  // R8G8B8A8_SRGB, MUTABLE_FORMAT, COLOR_ATTACHMENT_OPTIMAL on entry/exit
    std::uint32_t arrayLayer = 0;
    VkExtent2D extent{0, 0};
    Pose pose;
    Fov fov;
    VkImage fdmImage = VK_NULL_HANDLE;  // used only when foveation attachment is on
};

class SplatEngine {
public:
    /** Borrows the core's Vulkan handles (pocketsplat Context::init_external). */
    static std::unique_ptr<SplatEngine> Create(const EngineGpu& gpu, std::string* error);
    ~SplatEngine();

    /** Uploads the pack into both eye renderers (blocks on the queue: load time only). */
    bool SetScene(const splatcore::GpuPack& pack, std::string* error);
    void ClearScene();
    bool HasScene() const;

    /** Point size: multiplies the focal length used for the 2D covariance only (Spark focalAdjustment). 0.5..2. */
    void SetPointSize(float scale);
    float PointSize() const;
    /** pocketsplat contribution cull: drop splats below this many reference pixels (0 = off). Immediate. */
    void SetMinContribution(float pixels);

    /** 16 or 32 sort-key bits (applies immediately). */
    void SetKeyBits(int bits);
    int KeyBits() const;

    /**
     * Attach EyeTargetDesc::fdmImage as a fragment density map in the draw pass. Needs
     * fragmentDensityMapEnabled; rebuilds the draw pipelines (re-uploads the current scene).
     */
    bool SetFoveationAttachment(bool on, std::string* error);
    bool FoveationAttachment() const;

    /**
     * Records both eyes: cull/preprocess/sort compute + draw per eye. Leaves images in
     * COLOR_ATTACHMENT_OPTIMAL. frameSlot is the core slot (0/1); core waited for its previous use.
     * Fills `out` with the timings resolved from the previous use of this slot.
     */
    void Record(VkCommandBuffer cmd, std::uint32_t frameSlot, const EyeTargetDesc eyes[2], const Mat4& worldFromScene,
                FrameSample* out);

    /** Drops cached image views (call when the swapchain is rebuilt); destruction is deferred 2 frames. */
    void ForgetTargets();

    std::string DeviceName() const;

private:
    SplatEngine();
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace qnsplat
