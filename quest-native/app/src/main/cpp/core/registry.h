// Core-internal registry access. Modules use QN_REGISTER_MODULE from qn_api.h instead.
#pragma once
#include "core/qn_api.h"

namespace qn {
std::vector<ModuleInfo>& RegisteredModules();
// Index into `modules` of the viewer for this request, or -1.
int FindViewerIndex(const std::vector<ModuleInfo>& modules, const OpenRequest& req);
}  // namespace qn
