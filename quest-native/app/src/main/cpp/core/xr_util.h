// Core-internal helpers. Owner: foundation.
#pragma once
#include "core/qn_log.h"

#define XR_TRY(call)                                                                \
    do {                                                                            \
        XrResult qn_r_ = (call);                                                    \
        if (XR_FAILED(qn_r_)) {                                                     \
            QN_LOGE("[core] %s failed: %d (%s:%d)", #call, (int)qn_r_, __FILE__, __LINE__); \
            return false;                                                           \
        }                                                                           \
    } while (0)

#define VK_TRY(call)                                                                \
    do {                                                                            \
        VkResult qn_v_ = (call);                                                    \
        if (qn_v_ != VK_SUCCESS) {                                                  \
            QN_LOGE("[core] %s failed: %d (%s:%d)", #call, (int)qn_v_, __FILE__, __LINE__); \
            return false;                                                           \
        }                                                                           \
    } while (0)

#define XR_PROC(instance, name, pfn) \
    xrGetInstanceProcAddr((instance), name, (PFN_xrVoidFunction*)&(pfn))
