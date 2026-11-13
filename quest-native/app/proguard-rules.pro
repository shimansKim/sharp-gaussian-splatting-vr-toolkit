# R8 keep rules for quest-native (docs/release.md).
# NOT active while app/build.gradle has minifyEnabled false. Turn R8 on only after a device check.
#
# Native code calls Java by name (JNI: FindAppClass + GetStaticMethodID on ui.UiBridge, video.VideoPlayer,
# video.DiagRunner, ...) and core.ModuleLoader loads com.sharp.questnative.<id>.Module with Class.forName.
# The app's own classes are small, so all of them are kept unchanged; R8 then only shrinks the libraries
# (Media3, Guava, Kotlin stdlib), which ship their own consumer rules.
-keep class com.sharp.questnative.** { *; }

# Java methods implemented in C++ (Java_com_sharp_questnative_...).
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}
