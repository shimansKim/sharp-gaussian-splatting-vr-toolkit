// adb-shell GPU benchmark for the splat engine: no OpenXR, no window, Vulkan only.
// Runs the same engine code the app runs (SplatEngine::Record, two eyes, Quest 3 FOV and IPD,
// SHARP placement), with the head swaying +-10 degrees, and prints QNSPLAT lines (1/s) plus a summary.
// Without the compositor there is no display sync: use the GPU ms, not the fps.
//
// usage: offscreen_bench <scene.ply> [--budget N] [--scale 1.0] [--key 16|32] [--seconds 20] [--label name]
//        A/B knobs: [--stereo 1|0] (shared sort, default 1) [--draw 0..3] [--half 0|1] [--probe 0..6]
//                   [--clear 0|1] (draw pass clears instead of loading) [--minc px] (contribution cull)
#include <volk.h>

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "frame_log.h"
#include "splat_engine.h"
#include "splat_scene.h"
#include "xr_camera.h"

using namespace qnsplat;

namespace {

int Fail(const std::string& m) {
    std::fprintf(stderr, "FAIL: %s\n", m.c_str());
    return 1;
}

Quat YawPitch(float yaw, float pitch) {
    const float cy = std::cos(yaw / 2), sy = std::sin(yaw / 2), cp = std::cos(pitch / 2), sp = std::sin(pitch / 2);
    return {cy * sp, sy * cp, -sy * sp, cy * cp};
}

struct Device {
    VkInstance instance = VK_NULL_HANDLE;
    VkPhysicalDevice physical = VK_NULL_HANDLE;
    VkDevice device = VK_NULL_HANDLE;
    VkQueue queue = VK_NULL_HANDLE;
    std::uint32_t family = 0;
};

// Same features the app's FillDeviceFeatures requests.
bool CreateDevice(Device& d, std::string* err) {
    if (volkInitialize() != VK_SUCCESS) return *err = "no Vulkan loader", false;
    VkApplicationInfo app{VK_STRUCTURE_TYPE_APPLICATION_INFO};
    app.pApplicationName = "qnsplat-offscreen";
    app.apiVersion = VK_API_VERSION_1_3;
    VkInstanceCreateInfo ici{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
    ici.pApplicationInfo = &app;
    if (vkCreateInstance(&ici, nullptr, &d.instance) != VK_SUCCESS) return *err = "vkCreateInstance", false;
    volkLoadInstance(d.instance);
    std::uint32_t n = 0;
    vkEnumeratePhysicalDevices(d.instance, &n, nullptr);
    if (n == 0) return *err = "no GPU", false;
    std::vector<VkPhysicalDevice> pds(n);
    vkEnumeratePhysicalDevices(d.instance, &n, pds.data());
    d.physical = pds[0];
    std::uint32_t qn = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(d.physical, &qn, nullptr);
    std::vector<VkQueueFamilyProperties> qf(qn);
    vkGetPhysicalDeviceQueueFamilyProperties(d.physical, &qn, qf.data());
    bool found = false;
    for (std::uint32_t i = 0; i < qn && !found; ++i)
        if ((qf[i].queueFlags & VK_QUEUE_GRAPHICS_BIT) && (qf[i].queueFlags & VK_QUEUE_COMPUTE_BIT)) d.family = i, found = true;
    if (!found) return *err = "no graphics+compute queue", false;

    VkPhysicalDeviceVulkan13Features f13{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_3_FEATURES};
    f13.dynamicRendering = f13.synchronization2 = f13.shaderDemoteToHelperInvocation = VK_TRUE;
    f13.maintenance4 = f13.subgroupSizeControl = f13.computeFullSubgroups = VK_TRUE;
    VkPhysicalDeviceVulkan12Features f12{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_2_FEATURES};
    f12.timelineSemaphore = VK_TRUE;
    f12.pNext = &f13;
    VkPhysicalDeviceFeatures2 f2{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2};
    f2.pNext = &f12;
    const float prio = 1.0f;
    VkDeviceQueueCreateInfo qci{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
    qci.queueFamilyIndex = d.family;
    qci.queueCount = 1;
    qci.pQueuePriorities = &prio;
    VkDeviceCreateInfo dci{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
    dci.pNext = &f2;
    dci.queueCreateInfoCount = 1;
    dci.pQueueCreateInfos = &qci;
    if (vkCreateDevice(d.physical, &dci, nullptr, &d.device) != VK_SUCCESS)
        return *err = "vkCreateDevice (Vulkan 1.3 features missing?)", false;
    volkLoadDevice(d.device);
    vkGetDeviceQueue(d.device, d.family, 0, &d.queue);
    return true;
}

void Barrier(VkCommandBuffer cmd, VkImage image, VkImageLayout from, VkImageLayout to) {
    VkImageMemoryBarrier2 b{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER_2};
    b.srcStageMask = VK_PIPELINE_STAGE_2_ALL_COMMANDS_BIT;
    b.srcAccessMask = VK_ACCESS_2_MEMORY_WRITE_BIT;
    b.dstStageMask = VK_PIPELINE_STAGE_2_ALL_COMMANDS_BIT;
    b.dstAccessMask = VK_ACCESS_2_MEMORY_READ_BIT | VK_ACCESS_2_MEMORY_WRITE_BIT;
    b.oldLayout = from;
    b.newLayout = to;
    b.srcQueueFamilyIndex = b.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    b.image = image;
    b.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 2};
    VkDependencyInfo dep{VK_STRUCTURE_TYPE_DEPENDENCY_INFO};
    dep.imageMemoryBarrierCount = 1;
    dep.pImageMemoryBarriers = &b;
    vkCmdPipelineBarrier2(cmd, &dep);
}

std::uint32_t FindMemory(VkPhysicalDevice pd, std::uint32_t bits, VkMemoryPropertyFlags want) {
    VkPhysicalDeviceMemoryProperties mp;
    vkGetPhysicalDeviceMemoryProperties(pd, &mp);
    for (std::uint32_t i = 0; i < mp.memoryTypeCount; ++i)
        if ((bits & (1u << i)) && (mp.memoryTypes[i].propertyFlags & want) == want) return i;
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: offscreen_bench <scene.ply> [--budget N] [--scale s] [--key 16|32] [--seconds n] [--label name]"
                             " [--stereo 1|0] [--draw 0..3] [--half 0|1] [--probe 0..6] [--clear 0|1] [--minc px]\n");
        return 2;
    }
    const std::string path = argv[1];
    LoadOptions opt;
    float scale = 1.0f;
    int key = 16;
    double seconds = 20;
    std::string label, snapshot;
    bool motion = true;
    int stereo = 1, draw = -1, half = 0, probe = 0, clearInDraw = 0;
    float minc = 0.0f, acut = 1.0f, sd2 = 8.0f, maxpx = 2048.0f;
    for (int i = 2; i + 1 < argc; i += 2) {
        const std::string k = argv[i];
        if (k == "--budget") opt.max_splats = std::strtoull(argv[i + 1], nullptr, 10);
        else if (k == "--scale") scale = std::strtof(argv[i + 1], nullptr);
        else if (k == "--key") key = std::atoi(argv[i + 1]);
        else if (k == "--seconds") seconds = std::atof(argv[i + 1]);
        else if (k == "--label") label = argv[i + 1];
        else if (k == "--stereo") stereo = std::atoi(argv[i + 1]);
        else if (k == "--draw") draw = std::atoi(argv[i + 1]);
        else if (k == "--half") half = std::atoi(argv[i + 1]);
        else if (k == "--probe") probe = std::atoi(argv[i + 1]);
        else if (k == "--clear") clearInDraw = std::atoi(argv[i + 1]);
        else if (k == "--minc") minc = std::strtof(argv[i + 1], nullptr);
        else if (k == "--acut") acut = std::strtof(argv[i + 1], nullptr);
        else if (k == "--sd2") sd2 = std::strtof(argv[i + 1], nullptr);
        else if (k == "--maxpx") maxpx = std::strtof(argv[i + 1], nullptr);
        else if (k == "--snapshot") snapshot = argv[i + 1];
        else if (k == "--motion") motion = std::atoi(argv[i + 1]) != 0;
        else return Fail("unknown option: " + k);
    }

    if (!std::isfinite(scale) || scale < 0.25f || scale > 2.0f || !std::isfinite(seconds) || seconds <= 0)
        return Fail("scale must be 0.25..2; seconds must be positive");
    auto scene = load_sharp_scene_file(path, opt);
    if (!scene) return Fail(scene.error());
    std::printf("load: %s\n", describe(scene.value()).c_str());

    Device d;
    std::string err;
    if (!CreateDevice(d, &err)) return Fail(err);
    EngineGpu g;
    g.instance = d.instance;
    g.physicalDevice = d.physical;
    g.device = d.device;
    g.queue = d.queue;
    g.queueFamily = d.family;
    g.getInstanceProcAddr = vkGetInstanceProcAddr;
    auto engine = SplatEngine::Create(g, &err);
    if (!engine) return Fail(err);
    if (!engine->SetStereoShared(stereo != 0, &err)) return Fail(err);
    if (draw >= 0) engine->SetDrawMode(draw);
    engine->SetHalfFragment(half != 0);
    engine->SetMinContribution(minc);
    engine->SetAlphaCut(acut);
    engine->SetSupport(sd2, maxpx);
    if (!engine->SetScene(scene.value().pack, &err)) return Fail(err);
    engine->SetKeyBits(key);
    engine->SetDrawProbe(probe);
    std::printf("knobs: stereo=%d draw=%d half=%d probe=%d clear=%d minc=%.2f\n", engine->StereoShared() ? 1 : 0,
                engine->DrawMode(), half, probe, clearInDraw, minc);
    std::printf("device: %s\n", engine->DeviceName().c_str());

    // Quest 3 recommended eye buffer 1680x1760 (approx.) x scale; projection image like the app's.
    const std::uint32_t w = static_cast<std::uint32_t>(std::lround(1680 * scale));
    const std::uint32_t h = static_cast<std::uint32_t>(std::lround(1760 * scale));
    VkImageCreateInfo ii{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
    ii.flags = VK_IMAGE_CREATE_MUTABLE_FORMAT_BIT;
    ii.imageType = VK_IMAGE_TYPE_2D;
    ii.format = VK_FORMAT_R8G8B8A8_SRGB;
    ii.extent = {w, h, 1};
    ii.mipLevels = 1;
    ii.arrayLayers = 2;
    ii.samples = VK_SAMPLE_COUNT_1_BIT;
    ii.usage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT;
    VkImage image;
    if (vkCreateImage(d.device, &ii, nullptr, &image) != VK_SUCCESS) return Fail("image");
    VkMemoryRequirements mr;
    vkGetImageMemoryRequirements(d.device, image, &mr);
    VkMemoryAllocateInfo mai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    mai.allocationSize = mr.size;
    mai.memoryTypeIndex = FindMemory(d.physical, mr.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    VkDeviceMemory mem;
    if (vkAllocateMemory(d.device, &mai, nullptr, &mem) != VK_SUCCESS) return Fail("memory");
    vkBindImageMemory(d.device, image, mem, 0);

    VkCommandPool pool;
    VkCommandPoolCreateInfo pci{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
    pci.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
    pci.queueFamilyIndex = d.family;
    vkCreateCommandPool(d.device, &pci, nullptr, &pool);
    VkCommandBuffer cmds[2];
    VkCommandBufferAllocateInfo cai{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
    cai.commandPool = pool;
    cai.commandBufferCount = 2;
    vkAllocateCommandBuffers(d.device, &cai, cmds);
    VkFence fences[2];
    for (auto& f : fences) {
        VkFenceCreateInfo fci{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
        fci.flags = VK_FENCE_CREATE_SIGNALED_BIT;
        vkCreateFence(d.device, &fci, nullptr, &f);
    }

    const Fov fov[2] = {{-0.9425f, 0.6981f, 0.7330f, -0.9425f}, {-0.6981f, 0.9425f, 0.7330f, -0.9425f}};
    const float ipd = 0.064f;
    Pose head0;
    head0.position = {0.0f, 1.6f, 0.0f};
    const Mat4 wfs = sharp_initial_placement(head0, 0.0f);

    FrameContext fc;
    fc.splats = static_cast<std::uint32_t>(scene.value().pack.header.count);
    fc.eye_w = w;
    fc.eye_h = h;
    fc.scale = scale;
    fc.key_bits = key;
    fc.hz = 72;
    if (label.empty()) {
        const std::string base = path.substr(path.find_last_of('/') + 1);
        label = "offscreen_" + base.substr(0, base.find_last_of('.')) + "_" + std::to_string((fc.splats + 500) / 1000) + "k";
    }
    fc.label = label;
    std::vector<double> gpu;
    FrameLog log(
        [&](const std::string& line) {
            std::printf("%s\n", line.c_str());
            std::fflush(stdout);
        },
        nullptr);

    const auto t0 = std::chrono::steady_clock::now();
    std::uint32_t frame = 0;
    for (;;) {
        const double t = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
        if (t > seconds) break;
        const std::uint32_t slot = frame & 1u;
        vkWaitForFences(d.device, 1, &fences[slot], VK_TRUE, UINT64_MAX);
        vkResetFences(d.device, 1, &fences[slot]);
        VkCommandBuffer cmd = cmds[slot];
        vkResetCommandBuffer(cmd, 0);
        VkCommandBufferBeginInfo bi{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
        vkBeginCommandBuffer(cmd, &bi);
        // Like core: clear, then COLOR_ATTACHMENT_OPTIMAL.
        Barrier(cmd, image, VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL);
        const VkClearColorValue clear{{0.01f, 0.012f, 0.02f, 1.0f}};
        const VkImageSubresourceRange range{VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 2};
        if (!clearInDraw) vkCmdClearColorImage(cmd, image, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, &clear, 1, &range);
        Barrier(cmd, image, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);

        // motion=0 is for reproducible pictures, NOT timing: static views reuse computed records.
        const float ph = motion ? static_cast<float>(t) : 0.0f;
        Pose head = head0;
        head.orientation = YawPitch(0.1745f * std::sin(ph * 1.3f), 0.0524f * std::sin(ph * 0.7f));
        const Mat4 hm = mat_from_pose(head);
        EyeTargetDesc eyes[2];
        for (int e = 0; e < 2; ++e) {
            const float side = e == 0 ? -0.5f * ipd : 0.5f * ipd;
            eyes[e].image = image;
            eyes[e].arrayLayer = static_cast<std::uint32_t>(e);
            eyes[e].extent = {w, h};
            eyes[e].pose = head;
            eyes[e].pose.position = {head.position.x + side * hm.m[0], head.position.y + side * hm.m[1],
                                     head.position.z + side * hm.m[2]};
            eyes[e].fov = fov[e];
            eyes[e].clear = clearInDraw != 0;
            for (int i = 0; i < 4; ++i) eyes[e].clearColor[i] = clear.float32[i];
        }
        FrameSample s;
        engine->Record(cmd, slot, eyes, wfs, &s);
        fc.stereo = engine->StereoShared();
        fc.draw = engine->DrawMode();
        fc.half = engine->HalfFragment();
        fc.probe = engine->DrawProbe();
        fc.minc = engine->MinContribution();
        fc.acut = engine->AlphaCut();
        fc.sd2 = engine->SupportR2();
        fc.maxpx = engine->MaxPixelRadius();
        vkEndCommandBuffer(cmd);
        VkSubmitInfo si{VK_STRUCTURE_TYPE_SUBMIT_INFO};
        si.commandBufferCount = 1;
        si.pCommandBuffers = &cmd;
        vkQueueSubmit(d.queue, 1, &si, fences[slot]);
        if (log.add(t, s, fc) && t > 2.0) gpu.push_back(log.last_gpu_ms());
        ++frame;
    }
    vkDeviceWaitIdle(d.device);
    double sum = 0;
    for (double x : gpu) sum += x;
    std::printf("QNSPLAT_SUMMARY label=%s offscreen=1 seconds=%zu gpu_ms=%.2f splats=%u eye=%ux%u key=%d stereo=%d draw=%d "
                "half=%d probe=%d clear=%d minc=%.2f budget72hz_ms=13.89\n",
                label.c_str(), gpu.size(), gpu.empty() ? 0.0 : sum / static_cast<double>(gpu.size()), fc.splats, w, h, key,
                engine->StereoShared() ? 1 : 0, engine->DrawMode(), half, probe, clearInDraw, minc);

    if (!snapshot.empty()) {
        // Read both eye layers after the timed loop. PPM needs no image library and adds no APK dependency.
        const VkDeviceSize bytes = VkDeviceSize(w) * h * 2 * 4;
        VkBufferCreateInfo bc{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
        bc.size = bytes;
        bc.usage = VK_BUFFER_USAGE_TRANSFER_DST_BIT;
        VkBuffer buffer;
        if (vkCreateBuffer(d.device, &bc, nullptr, &buffer) != VK_SUCCESS) return Fail("snapshot buffer");
        VkMemoryRequirements req;
        vkGetBufferMemoryRequirements(d.device, buffer, &req);
        VkMemoryAllocateInfo alloc{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
        alloc.allocationSize = req.size;
        alloc.memoryTypeIndex = FindMemory(d.physical, req.memoryTypeBits,
                                           VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
        VkDeviceMemory host;
        if (vkAllocateMemory(d.device, &alloc, nullptr, &host) != VK_SUCCESS) return Fail("snapshot allocation");
        if (vkBindBufferMemory(d.device, buffer, host, 0) != VK_SUCCESS) return Fail("snapshot bind");
        VkCommandBuffer cmd = cmds[0];
        vkResetCommandBuffer(cmd, 0);
        VkCommandBufferBeginInfo begin{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
        vkBeginCommandBuffer(cmd, &begin);
        Barrier(cmd, image, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL);
        VkBufferImageCopy copy{};
        copy.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 2};
        copy.imageExtent = {w, h, 1};
        vkCmdCopyImageToBuffer(cmd, image, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, buffer, 1, &copy);
        VkMemoryBarrier2 hostBarrier{VK_STRUCTURE_TYPE_MEMORY_BARRIER_2};
        hostBarrier.srcStageMask = VK_PIPELINE_STAGE_2_COPY_BIT;
        hostBarrier.srcAccessMask = VK_ACCESS_2_TRANSFER_WRITE_BIT;
        hostBarrier.dstStageMask = VK_PIPELINE_STAGE_2_HOST_BIT;
        hostBarrier.dstAccessMask = VK_ACCESS_2_HOST_READ_BIT;
        VkDependencyInfo dep{VK_STRUCTURE_TYPE_DEPENDENCY_INFO};
        dep.memoryBarrierCount = 1;
        dep.pMemoryBarriers = &hostBarrier;
        vkCmdPipelineBarrier2(cmd, &dep);
        vkEndCommandBuffer(cmd);
        VkSubmitInfo submit{VK_STRUCTURE_TYPE_SUBMIT_INFO};
        submit.commandBufferCount = 1;
        submit.pCommandBuffers = &cmd;
        if (vkQueueSubmit(d.queue, 1, &submit, VK_NULL_HANDLE) != VK_SUCCESS) return Fail("snapshot submit");
        vkQueueWaitIdle(d.queue);
        void* mapped = nullptr;
        if (vkMapMemory(d.device, host, 0, bytes, 0, &mapped) != VK_SUCCESS) return Fail("snapshot map");
        const auto* rgba = static_cast<const unsigned char*>(mapped);
        FILE* f = std::fopen(snapshot.c_str(), "wb");
        if (!f) return Fail("cannot open snapshot file");
        std::fprintf(f, "P6\n%u %u\n255\n", w * 2, h);
        std::vector<unsigned char> row(w * 2 * 3);
        for (std::uint32_t y = 0; y < h; ++y) {
            for (std::uint32_t e = 0; e < 2; ++e) for (std::uint32_t x = 0; x < w; ++x)
                std::memcpy(row.data() + (e*w+x)*3, rgba + (std::size_t(e)*w*h + y*w+x)*4, 3);
            if (std::fwrite(row.data(), 1, row.size(), f) != row.size()) return Fail("snapshot write");
        }
        std::fclose(f);
        vkUnmapMemory(d.device, host);
        vkDestroyBuffer(d.device, buffer, nullptr);
        vkFreeMemory(d.device, host, nullptr);
    }

    engine.reset();
    for (auto f : fences) vkDestroyFence(d.device, f, nullptr);
    vkDestroyCommandPool(d.device, pool, nullptr);
    vkDestroyImage(d.device, image, nullptr);
    vkFreeMemory(d.device, mem, nullptr);
    vkDestroyDevice(d.device, nullptr);
    vkDestroyInstance(d.instance, nullptr);
    std::printf("OK\n");
    return 0;
}
