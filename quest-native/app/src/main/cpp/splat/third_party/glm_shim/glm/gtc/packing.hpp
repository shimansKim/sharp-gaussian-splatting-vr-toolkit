// quest-native: minimal stand-in for glm/gtc/packing.hpp (glm 1.0.3, MIT).
// pocketsplat core/src/pack.cpp only uses glm::packHalf1x16 / glm::unpackHalf1x16, so instead of
// vendoring all of glm this header provides those two functions (IEEE 754 binary16,
// round-to-nearest-even, inf/NaN preserved, denormals handled). Written for quest-native.
#pragma once

#include <cstdint>
#include <cstring>

namespace glm {

inline std::uint16_t packHalf1x16(float value) {
    std::uint32_t f;
    std::memcpy(&f, &value, sizeof(f));
    const std::uint32_t sign = (f >> 16) & 0x8000u;
    const std::uint32_t abs = f & 0x7FFFFFFFu;
    if (abs >= 0x7F800000u) {  // inf or NaN
        return static_cast<std::uint16_t>(sign | 0x7C00u | (abs > 0x7F800000u ? 0x200u : 0u));
    }
    if (abs >= 0x477FF000u) {  // rounds to >= 65520 -> inf
        return static_cast<std::uint16_t>(sign | 0x7C00u);
    }
    if (abs < 0x38800000u) {  // below the smallest normal half (2^-14): denormal or zero
        if (abs < 0x33000000u) return static_cast<std::uint16_t>(sign);  // < 2^-25 rounds to 0
        const std::uint32_t exp = abs >> 23;  // 102..112
        const std::uint32_t mant = (abs & 0x7FFFFFu) | 0x800000u;
        // value = mant * 2^(exp-150); half denormal unit = 2^-24 -> h = mant * 2^(exp-126)
        const std::uint32_t rshift = 126u - exp;  // 14..24
        std::uint32_t h = mant >> rshift;
        const std::uint32_t rem = mant & ((1u << rshift) - 1u);
        const std::uint32_t half_point = 1u << (rshift - 1u);
        if (rem > half_point || (rem == half_point && (h & 1u))) ++h;
        return static_cast<std::uint16_t>(sign | h);
    }
    // normal: rebias exponent 127 -> 15, round mantissa 23 -> 10 bits (nearest even)
    std::uint32_t h = ((abs - 0x38000000u) >> 13);
    const std::uint32_t rem = abs & 0x1FFFu;
    if (rem > 0x1000u || (rem == 0x1000u && (h & 1u))) ++h;  // may carry into the exponent: still correct
    return static_cast<std::uint16_t>(sign | h);
}

inline float unpackHalf1x16(std::uint16_t value) {
    const std::uint32_t sign = (static_cast<std::uint32_t>(value) & 0x8000u) << 16;
    const std::uint32_t exp = (value >> 10) & 0x1Fu;
    std::uint32_t mant = value & 0x3FFu;
    std::uint32_t f;
    if (exp == 0) {
        if (mant == 0) {
            f = sign;
        } else {  // denormal: normalize
            int e = -1;
            do {
                ++e;
                mant <<= 1;
            } while ((mant & 0x400u) == 0);
            f = sign | (static_cast<std::uint32_t>(112 - e) << 23) | ((mant & 0x3FFu) << 13);
        }
    } else if (exp == 31) {
        f = sign | 0x7F800000u | (mant << 13);
    } else {
        f = sign | ((exp + 112u) << 23) | (mant << 13);
    }
    float out;
    std::memcpy(&out, &f, sizeof(out));
    return out;
}

}  // namespace glm
