package com.sharp.questnative.core;

/**
 * Java half of a module. Each module has exactly one class named
 * {@code com.sharp.questnative.<id>.Module} implementing this; {@link ModuleLoader} finds it by name,
 * so registering needs no edit outside the module folder. Methods run on the Android main thread.
 * Owner: foundation.
 */
public interface QnModule {
    void onCreate(QnActivity activity);

    default void onDestroy() {}
}
