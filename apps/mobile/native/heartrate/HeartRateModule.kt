package com.afeka.fitapp.heartrate

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable

/**
 * The phone's end of the heart-rate bridge.
 *
 * The NovaFit app on the watch reads the sensor and sends each reading over the Wearable Data
 * Layer; this hears them and hands them to JavaScript as `novafit-heart-rate` events. It also
 * carries the two messages that go the other way: start measuring, stop measuring.
 *
 * The listener is registered here, at runtime, for exactly as long as a workout is open — not as
 * a manifest service. A manifest `WearableListenerService` would be an exported component that
 * Google Play services wakes the app for at one message a second; a listener that only exists
 * while the workout screen does is less surface and less work, and there is nobody to show a
 * heart rate to when that screen is closed anyway.
 *
 * Both apps must share an application id and a signing key, or the Data Layer treats them as
 * strangers and delivers nothing. See native/wear/README.md.
 */
class HeartRateModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), MessageClient.OnMessageReceivedListener {

    private var listening = false

    override fun getName(): String = NAME

    /** Ask every connected watch to start measuring, and start listening for what they send. */
    @ReactMethod
    fun start(promise: Promise) {
        listen()
        send(PATH_START, promise)
    }

    /** Tell the watches the workout is over, and stop listening. */
    @ReactMethod
    fun stop(promise: Promise) {
        unlisten()
        send(PATH_STOP, promise)
    }

    // NativeEventEmitter asks for these two on every native module that emits; they have nothing
    // to do here, because the listener's lifetime is start() and stop(), not JS subscriptions.
    @ReactMethod
    fun addListener(eventName: String) = Unit

    @ReactMethod
    fun removeListeners(count: Double) = Unit

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != PATH_HEART_RATE) return
        val bpm = String(event.data, Charsets.UTF_8).trim().toIntOrNull() ?: return
        if (!reactContext.hasActiveReactInstance()) return

        val payload = Arguments.createMap().apply {
            putInt("bpm", bpm)
            putDouble("at", System.currentTimeMillis().toDouble())
        }
        reactContext.emitDeviceEvent(EVENT, payload)
    }

    override fun invalidate() {
        unlisten()
        super.invalidate()
    }

    private fun listen() {
        if (listening) return
        try {
            Wearable.getMessageClient(reactContext).addListener(this)
            listening = true
        } catch (_: Exception) {
            // No Google Play services, or none that speaks to a watch: there is no reading to
            // show, which is what the screen already assumes.
        }
    }

    private fun unlisten() {
        if (!listening) return
        listening = false
        try {
            Wearable.getMessageClient(reactContext).removeListener(this)
        } catch (_: Exception) {
            // Nothing to undo.
        }
    }

    /**
     * Send an empty message on [path] to every connected node, resolving with how many there were.
     *
     * Always resolves, never rejects: a phone with no watch is the ordinary case, not an error,
     * and JavaScript has nothing useful to do with the difference.
     */
    private fun send(path: String, promise: Promise) {
        try {
            Wearable.getNodeClient(reactContext).connectedNodes
                .addOnSuccessListener { nodes ->
                    val messages = Wearable.getMessageClient(reactContext)
                    for (node in nodes) messages.sendMessage(node.id, path, ByteArray(0))
                    promise.resolve(nodes.size)
                }
                .addOnFailureListener { promise.resolve(0) }
        } catch (_: Exception) {
            promise.resolve(0)
        }
    }

    companion object {
        const val NAME = "NovaFitHeartRate"

        /** The JavaScript event. Changing it means changing liveHeartRate.ts too. */
        const val EVENT = "novafit-heart-rate"

        // The three paths, which the watch app spells identically — see native/wear.
        const val PATH_HEART_RATE = "/novafit/heart-rate"
        const val PATH_START = "/novafit/start"
        const val PATH_STOP = "/novafit/stop"
    }
}
