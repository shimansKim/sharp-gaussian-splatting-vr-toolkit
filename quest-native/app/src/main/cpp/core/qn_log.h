// Logging for all modules. logcat tag "QuestNative"; put your module id first: QN_LOGI("[splat] ...").
#pragma once
#include <android/log.h>

#define QN_LOG_TAG "QuestNative"
#define QN_LOGI(...) __android_log_print(ANDROID_LOG_INFO, QN_LOG_TAG, __VA_ARGS__)
#define QN_LOGW(...) __android_log_print(ANDROID_LOG_WARN, QN_LOG_TAG, __VA_ARGS__)
#define QN_LOGE(...) __android_log_print(ANDROID_LOG_ERROR, QN_LOG_TAG, __VA_ARGS__)
