package com.afeka.fitapp.wear

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.widget.Button
import android.widget.TextView

/**
 * The watch's one screen: the heart rate, large, and a button.
 *
 * Almost nobody should need to look at this. The phone starts and stops the measuring when a
 * workout does; this screen exists to grant the sensor permission the first time, to show that a
 * reading is actually arriving, and to start it by hand on the releases of Wear OS that will not
 * let the phone do so from the background.
 *
 * A plain `Activity` and an XML layout, with no Compose and no AppCompat: the watch app's whole
 * dependency list is the Wearable Data Layer, which keeps it a few hundred kilobytes and keeps it
 * out of the phone app's Kotlin and Compose version arguments.
 */
class MainActivity : Activity() {

    private lateinit var value: TextView
    private lateinit var status: TextView
    private lateinit var toggle: Button

    private val handler = Handler(Looper.getMainLooper())
    private val tick = object : Runnable {
        override fun run() {
            render()
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        value = findViewById(R.id.bpm)
        status = findViewById(R.id.status)
        toggle = findViewById(R.id.toggle)

        toggle.setOnClickListener {
            if (HeartRateService.running) HeartRateService.stop(this) else begin()
            // The service flips its own flag on its own thread of events; ask again in a moment
            // rather than drawing what was true before the tap.
            handler.postDelayed({ render() }, 300)
        }

        // Opening the app is a request to measure: there is nothing else it is for.
        begin()
    }

    override fun onResume() {
        super.onResume()
        handler.post(tick)
    }

    override fun onPause() {
        handler.removeCallbacks(tick)
        super.onPause()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (hasSensorPermission()) HeartRateService.start(this)
        render()
    }

    /** Start measuring, asking for the sensor first if it has not been granted. */
    private fun begin() {
        if (hasSensorPermission()) {
            HeartRateService.start(this)
            return
        }
        val wanted = mutableListOf(Manifest.permission.BODY_SENSORS)
        // The foreground service's notification, which Android 13 made a permission of its own.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            wanted += Manifest.permission.POST_NOTIFICATIONS
        }
        requestPermissions(wanted.toTypedArray(), REQUEST_SENSORS)
    }

    private fun hasSensorPermission(): Boolean =
        checkSelfPermission(Manifest.permission.BODY_SENSORS) == PackageManager.PERMISSION_GRANTED

    private fun render() {
        val running = HeartRateService.running
        val age = SystemClock.elapsedRealtime() - HeartRateService.latestAt
        val fresh = running && HeartRateService.latestBpm > 0 && age < STALE_AFTER_MS

        value.text = if (fresh) HeartRateService.latestBpm.toString() else "--"
        status.setText(
            when {
                !hasSensorPermission() -> R.string.need_permission
                !running -> R.string.stopped
                fresh -> R.string.sending
                else -> R.string.waiting
            },
        )
        toggle.setText(if (running) R.string.stop else R.string.start)
    }

    private companion object {
        const val REQUEST_SENSORS = 1

        /** The same patience the phone has: past this, the number is no longer current. */
        const val STALE_AFTER_MS = 8000L
    }
}
