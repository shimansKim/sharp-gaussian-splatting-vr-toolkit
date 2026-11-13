// Proves at build time that GLSL -> SPIR-V -> #include works. Owner: foundation.
#include <cstdint>

#include "core/qn_log.h"

namespace qn {
static const uint32_t kFillSpv[] =
#include "fill.comp.spv.inc"
    ;

// Returns the SPIR-V word count, or 0 when the magic number is wrong.
uint32_t ShaderCheckWords() {
    return kFillSpv[0] == 0x07230203u ? (uint32_t)(sizeof(kFillSpv) / sizeof(kFillSpv[0])) : 0u;
}
}  // namespace qn
