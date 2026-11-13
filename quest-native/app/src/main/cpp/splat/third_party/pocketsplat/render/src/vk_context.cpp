#include "splatrender/vk_context.h"

#ifndef POCKETSPLAT_NO_VKBOOTSTRAP
#include <VkBootstrap.h>
#endif

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <string>
#include <vector>

namespace splatrender {
namespace {

[[maybe_unused]] VKAPI_ATTR VkBool32 VKAPI_CALL debug_callback(VkDebugUtilsMessageSeverityFlagBitsEXT severity,
                                              VkDebugUtilsMessageTypeFlagsEXT /*type*/,
                                              const VkDebugUtilsMessengerCallbackDataEXT* data,
                                              void* user_data) {
    auto* context = static_cast<Context*>(user_data);
    if (severity &
        (VK_DEBUG_UTILS_MESSAGE_SEVERITY_WARNING_BIT_EXT | VK_DEBUG_UTILS_MESSAGE_SEVERITY_ERROR_BIT_EXT)) {
        context->count_validation_message();
        std::fprintf(stderr, "[vulkan] %s\n", data->pMessage ? data->pMessage : "(no message)");
    }
    return VK_FALSE;
}

std::string version_string(std::uint32_t version) {
    return std::to_string(VK_API_VERSION_MAJOR(version)) + "." +
           std::to_string(VK_API_VERSION_MINOR(version)) + "." +
           std::to_string(VK_API_VERSION_PATCH(version));
}

[[maybe_unused]] std::string lower(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
}

const char* type_name(VkPhysicalDeviceType type) {
    switch (type) {
        case VK_PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU:
            return "integrated";
        case VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU:
            return "discrete";
        case VK_PHYSICAL_DEVICE_TYPE_VIRTUAL_GPU:
            return "virtual";
        case VK_PHYSICAL_DEVICE_TYPE_CPU:
            return "CPU";
        default:
            return "other";
    }
}

[[maybe_unused]] constexpr const char* kDriverHint = "Updating the graphics driver usually adds Vulkan 1.3 support.";

}  // namespace

#ifndef POCKETSPLAT_NO_VKBOOTSTRAP
splatcore::Status Context::init(const ContextCreateInfo& info) {
    using splatcore::Status;
    m_devices_found.clear();
    if (volkInitialize() != VK_SUCCESS) {
        return Status::failure(
            std::string("No Vulkan driver was found on this computer (the Vulkan loader is missing). ") +
            kDriverHint);
    }
    // The loader's own version caps what any instance can ask for (1.0 loaders lack the query).
    std::uint32_t loader_version = VK_API_VERSION_1_0;
    if (vkEnumerateInstanceVersion != nullptr) vkEnumerateInstanceVersion(&loader_version);
    if (loader_version < VK_API_VERSION_1_3) {
        return Status::failure("The installed Vulkan runtime is version " + version_string(loader_version) +
                               "; PocketSplat needs Vulkan 1.3. " + kDriverHint);
    }

    vkb::InstanceBuilder instance_builder;
    instance_builder.set_app_name(info.app_name).set_engine_name("splatrender").require_api_version(1, 3, 0);
    if (info.enable_validation) {
        instance_builder.request_validation_layers(true)
            .set_debug_callback(debug_callback)
            .set_debug_callback_user_data_pointer(this)
            .set_debug_messenger_severity(VK_DEBUG_UTILS_MESSAGE_SEVERITY_WARNING_BIT_EXT |
                                          VK_DEBUG_UTILS_MESSAGE_SEVERITY_ERROR_BIT_EXT)
            .set_debug_messenger_type(VK_DEBUG_UTILS_MESSAGE_TYPE_GENERAL_BIT_EXT |
                                      VK_DEBUG_UTILS_MESSAGE_TYPE_VALIDATION_BIT_EXT |
                                      VK_DEBUG_UTILS_MESSAGE_TYPE_PERFORMANCE_BIT_EXT);
    }
    auto instance_result = instance_builder.build();
    if (!instance_result) {
        return Status::failure("instance creation failed: " + instance_result.error().message());
    }
    m_instance = instance_result->instance;
    m_messenger = instance_result->debug_messenger;
    volkLoadInstance(m_instance);

    // Every GPU the driver reports, for the messages below and for hosts (--list-gpus).
    {
        std::uint32_t count = 0;
        vkEnumeratePhysicalDevices(m_instance, &count, nullptr);
        std::vector<VkPhysicalDevice> devices(count);
        vkEnumeratePhysicalDevices(m_instance, &count, devices.data());
        for (VkPhysicalDevice device : devices) {
            VkPhysicalDeviceProperties properties{};
            vkGetPhysicalDeviceProperties(device, &properties);
            m_devices_found += std::string(properties.deviceName) + " (Vulkan " +
                               version_string(properties.apiVersion) + ", " +
                               type_name(properties.deviceType) + ")\n";
        }
    }

    VkPhysicalDeviceVulkan12Features features12{};
    features12.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_2_FEATURES;
    features12.timelineSemaphore = VK_TRUE;
    VkPhysicalDeviceVulkan13Features features13{};
    features13.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_3_FEATURES;
    features13.dynamicRendering = VK_TRUE;
    features13.synchronization2 = VK_TRUE;
    // glslang emits OpDemoteToHelperInvocation for `discard` when targeting vulkan1.3.
    features13.shaderDemoteToHelperInvocation = VK_TRUE;
    // Specialization-constant workgroup sizes (local_size_x_id) compile to LocalSizeId.
    features13.maintenance4 = VK_TRUE;
    // Both mandatory in 1.3. Lets the sort require 16-lane subgroups where the size varies (Intel
    // reports 8-32); fixed-size GPUs (Adreno 64, NVIDIA 32) never use it.
    features13.subgroupSizeControl = VK_TRUE;
    features13.computeFullSubgroups = VK_TRUE;

    vkb::PhysicalDeviceSelector selector(*instance_result);
    selector.set_minimum_version(1, 3)
        .set_required_features_12(features12)
        .set_required_features_13(features13)
        .defer_surface_initialization();
    if (info.request_dynamic_rendering_extension) {
        selector.add_required_extension(VK_KHR_DYNAMIC_RENDERING_EXTENSION_NAME);
    }
    auto suitable = selector.select_devices();
    if (!suitable || suitable->empty()) {
        return Status::failure(
            "No GPU on this computer supports Vulkan 1.3 with the features PocketSplat needs "
            "(dynamic rendering, synchronization2, maintenance4, timeline semaphores). GPUs found:\n" +
            (m_devices_found.empty() ? std::string("(none)\n") : m_devices_found) + kDriverHint);
    }
    vkb::Result<vkb::PhysicalDevice> physical_result = selector.select();  // the default: discrete first
    if (info.preferred_device != nullptr && info.preferred_device[0] != '\0') {
        const std::string wanted = lower(info.preferred_device);
        auto match = std::find_if(suitable->begin(), suitable->end(), [&](const vkb::PhysicalDevice& device) {
            return lower(device.name).find(wanted) != std::string::npos;
        });
        if (match == suitable->end()) {
            std::string names;
            for (const vkb::PhysicalDevice& device : *suitable) names += device.name + "\n";
            return Status::failure("No suitable GPU matches \"" + std::string(info.preferred_device) +
                                   "\". Suitable GPUs:\n" + names);
        }
        physical_result = *match;
    }
    if (!physical_result) {
        return Status::failure("no suitable Vulkan 1.3 device: " + physical_result.error().message());
    }

    auto device_result = vkb::DeviceBuilder(*physical_result).build();
    if (!device_result) {
        return Status::failure("device creation failed: " + device_result.error().message());
    }
    m_physical_device = physical_result->physical_device;
    m_device = device_result->device;
    volkLoadDevice(m_device);

    auto queue_result = device_result->get_queue(vkb::QueueType::graphics);
    auto family_result = device_result->get_queue_index(vkb::QueueType::graphics);
    if (!queue_result || !family_result) return Status::failure("no graphics queue");
    m_queue = queue_result.value();
    m_queue_family = family_result.value();

    return finish_init();
}
#else
splatcore::Status Context::init(const ContextCreateInfo&) {
    return splatcore::Status::failure("built without vk-bootstrap: use init_external");
}
#endif  // POCKETSPLAT_NO_VKBOOTSTRAP

splatcore::Status Context::init_external(const ExternalHandles& handles) {
    using splatcore::Status;
    if (handles.instance == VK_NULL_HANDLE || handles.physical_device == VK_NULL_HANDLE ||
        handles.device == VK_NULL_HANDLE || handles.queue == VK_NULL_HANDLE) {
        return Status::failure("init_external: null Vulkan handle");
    }
    if (handles.get_instance_proc_addr != nullptr) {
        volkInitializeCustom(handles.get_instance_proc_addr);
    } else if (volkInitialize() != VK_SUCCESS) {
        return Status::failure("init_external: Vulkan loader not found");
    }
    volkLoadInstanceOnly(handles.instance);
    m_external = true;
    m_instance = handles.instance;
    m_physical_device = handles.physical_device;

    VkPhysicalDeviceProperties properties{};
    vkGetPhysicalDeviceProperties(m_physical_device, &properties);
    m_devices_found = std::string(properties.deviceName) + " (Vulkan " + version_string(properties.apiVersion) +
                      ", " + type_name(properties.deviceType) + ")\n";
    if (properties.apiVersion < VK_API_VERSION_1_3) {
        return Status::failure("init_external: device reports Vulkan " + version_string(properties.apiVersion) +
                               "; PocketSplat needs 1.3");
    }

    // The features must have been enabled at device creation; check that the device supports them
    // so a host that forgot them fails here with a message instead of a driver crash later.
    VkPhysicalDeviceVulkan13Features f13{};
    f13.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_3_FEATURES;
    VkPhysicalDeviceVulkan12Features f12{};
    f12.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_2_FEATURES;
    f12.pNext = &f13;
    VkPhysicalDeviceFeatures2 f2{};
    f2.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2;
    f2.pNext = &f12;
    vkGetPhysicalDeviceFeatures2(m_physical_device, &f2);
    if (!f12.timelineSemaphore || !f13.dynamicRendering || !f13.synchronization2 ||
        !f13.shaderDemoteToHelperInvocation || !f13.maintenance4 || !f13.subgroupSizeControl ||
        !f13.computeFullSubgroups) {
        return Status::failure("init_external: device lacks a required Vulkan 1.2/1.3 feature");
    }

    m_device = handles.device;
    volkLoadDevice(m_device);
    m_queue = handles.queue;
    m_queue_family = handles.queue_family;
    return finish_init();
}

splatcore::Status Context::finish_init() {
    using splatcore::Status;
    VkPhysicalDeviceVulkan13Properties properties13{};
    properties13.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_3_PROPERTIES;
    VkPhysicalDeviceProperties2 properties2{};
    properties2.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROPERTIES_2;
    properties2.pNext = &properties13;
    vkGetPhysicalDeviceProperties2(m_physical_device, &properties2);
    const VkPhysicalDeviceProperties& properties = properties2.properties;
    m_min_subgroup_size = properties13.minSubgroupSize;
    m_max_subgroup_size = properties13.maxSubgroupSize;
    m_compute_subgroup_size_control =
        (properties13.requiredSubgroupSizeStages & VK_SHADER_STAGE_COMPUTE_BIT) != 0;
    m_timestamp_period_ns = properties.limits.timestampPeriod;
    m_max_storage_buffer_range = properties.limits.maxStorageBufferRange;
    std::snprintf(m_device_name, sizeof(m_device_name), "%s", properties.deviceName);

    VmaVulkanFunctions functions{};
    functions.vkGetInstanceProcAddr = vkGetInstanceProcAddr;
    functions.vkGetDeviceProcAddr = vkGetDeviceProcAddr;
    VmaAllocatorCreateInfo allocator_info{};
    allocator_info.physicalDevice = m_physical_device;
    allocator_info.device = m_device;
    allocator_info.instance = m_instance;
    allocator_info.vulkanApiVersion = VK_API_VERSION_1_3;
    allocator_info.pVulkanFunctions = &functions;
    if (vmaCreateAllocator(&allocator_info, &m_allocator) != VK_SUCCESS) {
        return Status::failure("VMA allocator creation failed");
    }
    return Status::success();
}

void Context::wait_idle() const {
    if (m_device != VK_NULL_HANDLE) vkDeviceWaitIdle(m_device);
}

void Context::destroy() {
    if (m_allocator != VK_NULL_HANDLE) {
        vmaDestroyAllocator(m_allocator);
        m_allocator = VK_NULL_HANDLE;
    }
    if (m_external) {  // borrowed handles belong to the host
        m_device = VK_NULL_HANDLE;
        m_instance = VK_NULL_HANDLE;
        m_external = false;
        return;
    }
    if (m_device != VK_NULL_HANDLE) {
        vkDestroyDevice(m_device, nullptr);
        m_device = VK_NULL_HANDLE;
    }
    if (m_messenger != VK_NULL_HANDLE) {
        vkDestroyDebugUtilsMessengerEXT(m_instance, m_messenger, nullptr);
        m_messenger = VK_NULL_HANDLE;
    }
    if (m_instance != VK_NULL_HANDLE) {
        vkDestroyInstance(m_instance, nullptr);
        m_instance = VK_NULL_HANDLE;
    }
}

}  // namespace splatrender
