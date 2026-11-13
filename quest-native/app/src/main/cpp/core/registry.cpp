// Module registry. Owner: foundation.
#include "core/registry.h"

#include <algorithm>
#include <cctype>
#include <cstring>

#include "core/qn_log.h"

namespace qn {

std::vector<ModuleInfo>& RegisteredModules() {
    static std::vector<ModuleInfo> modules;  // function-local: safe during static init
    return modules;
}

bool RegisterModule(ModuleInfo info) {
    for (auto& ext : info.fileExtensions) {
        std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) { return std::tolower(c); });
    }
    RegisteredModules().push_back(std::move(info));
    return true;
}

bool XrContext::HasExtension(const char* name) const {
    for (auto& e : enabledExtensions) {
        if (e == name) return true;
    }
    return false;
}

static std::string LowerExtension(const std::string& name) {
    std::string path = name;
    auto q = path.find_first_of("?#");
    if (q != std::string::npos) path.resize(q);
    auto dot = path.find_last_of('.');
    auto slash = path.find_last_of('/');
    if (dot == std::string::npos || (slash != std::string::npos && dot < slash)) return "";
    std::string ext = path.substr(dot);
    std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) { return std::tolower(c); });
    return ext;
}

int FindViewerIndex(const std::vector<ModuleInfo>& modules, const OpenRequest& req) {
    std::string ext = LowerExtension(req.name.empty() ? req.uri : req.name);
    if (ext.empty() && !req.name.empty()) ext = LowerExtension(req.uri);
    for (size_t i = 0; i < modules.size(); ++i) {
        if (modules[i].kind != ModuleKind::kViewer) continue;
        for (auto& e : modules[i].fileExtensions) {
            if (!ext.empty() && e == ext) return (int)i;
        }
    }
    if (!req.mimeType.empty()) {
        for (size_t i = 0; i < modules.size(); ++i) {
            if (modules[i].kind != ModuleKind::kViewer) continue;
            for (auto& p : modules[i].mimePrefixes) {
                if (req.mimeType.compare(0, p.size(), p) == 0) return (int)i;
            }
        }
    }
    return -1;
}

}  // namespace qn
