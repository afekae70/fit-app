package com.afeka.fitapp.wear

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService

/**
 * Hears the phone say that a workout has started or ended, and starts or stops measuring.
 *
 * This is what makes the watch app something nobody has to open: starting a workout on the phone
 * is the start. It is best effort. Wear OS restricts starting a foreground service from the
 * background, and whether a Data Layer message counts as permission to do so has varied between
 * releases — where it is refused, opening the app on the watch once does the same thing, and the
 * refusal is swallowed here rather than crashing a service the system is in the middle of
 * delivering a message to.
 */
class PhoneListenerService : WearableListenerService() {

    override fun onMessageReceived(event: MessageEvent) {
        when (event.path) {
            HeartRateService.PATH_START -> try {
                HeartRateService.start(this)
            } catch (_: Exception) {
                // Refused from the background. The app on the watch still starts it by hand.
            }

            HeartRateService.PATH_STOP -> HeartRateService.stop(this)
        }
    }
}
