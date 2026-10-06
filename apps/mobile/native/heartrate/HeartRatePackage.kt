package com.afeka.fitapp.heartrate

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers [HeartRateModule] with React Native.
 *
 * Added by hand to `MainApplication.getPackages()`: autolinking finds packages in node_modules,
 * and this one lives in the app itself.
 */
class HeartRatePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(HeartRateModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
