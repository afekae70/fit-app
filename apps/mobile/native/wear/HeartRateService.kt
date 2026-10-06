package com.afeka.fitapp.wear

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import com.google.android.gms.wearable.Wearable
import kotlin.math.roundToInt

/**
 * Reads the watch's heart-rate sensor and sends each reading to the phone.
 *
 * A foreground service, because a workout is an hour with the wrist down and the screen off, and
 * an activity stops being told about the sensor the moment it is not visible. The notification is
 * the price of that, and it is also honest: the sensor is on and the battery is paying for it.
 *
 * The plain `SensorManager` heart-rate sensor rather than Health Services' ExerciseClient. That
 * API owns the idea of "an exercise" — it would start a second workout on the watch, in competition
 * with the one the phone is recording, and Samsung Health would then write its own session for the
 * same hour. All this wants is the number.
 *
 * A partial wake lock is held while measuring. The heart-rate sensor is not a wake-up sensor: with
 * the CPU asleep its readings stop arriving, which is precisely when someone is mid-set and not
 * looking at their wrist.
 */
class HeartRateService : Service(), SensorEventListener {

    private var sensors: SensorManager? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var measuring = false

    private var nodes: List<String> = emptyList()
    private var nodesRefreshedAt = 0L
    private var sentAt = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Without the permission there is no sensor to read, and on Android 14 a health-type
        // foreground service started without it is an exception rather than a silent failure.
        if (checkSelfPermission(Manifest.permission.BODY_SENSORS) != PackageManager.PERMISSION_GRANTED) {
            stopSelf()
            return START_NOT_STICKY
        }

        startInForeground()

        if (!measuring) {
            val manager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
            val sensor = manager.getDefaultSensor(Sensor.TYPE_HEART_RATE)
            if (sensor == null) {
                stopSelf()
                return START_NOT_STICKY
            }
            sensors = manager
            manager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_NORMAL)

            val power = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "novafit:heart-rate").apply {
                // A ceiling, not a duration: stop() releases it. Three hours is longer than any
                // workout and short enough that a forgotten session does not flatten the watch.
                acquire(MAX_SESSION_MS)
            }

            measuring = true
            running = true
        }
        return START_STICKY
    }

    override fun onDestroy() {
        sensors?.unregisterListener(this)
        sensors = null
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        measuring = false
        running = false
        latestBpm = 0
        super.onDestroy()
    }

    override fun onSensorChanged(event: SensorEvent) {
        // NO_CONTACT is the watch off the wrist or riding loose; the value that comes with it is
        // whatever the sensor last believed.
        if (event.accuracy == SensorManager.SENSOR_STATUS_NO_CONTACT) return
        val bpm = event.values.firstOrNull()?.roundToInt() ?: return
        if (bpm <= 0) return

        latestBpm = bpm
        latestAt = SystemClock.elapsedRealtime()
        send(bpm)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    /**
     * One reading to every connected node, at most about once a second.
     *
     * Messages, not synced data: a heart rate from four seconds ago is worth nothing, so there is
     * no point in a transport that guarantees it eventually arrives. If the phone is out of reach
     * the reading is simply lost, and the next one is along shortly.
     */
    private fun send(bpm: Int) {
        val now = SystemClock.elapsedRealtime()

        if (nodes.isEmpty() || now - nodesRefreshedAt > NODE_REFRESH_MS) {
            nodesRefreshedAt = now
            Wearable.getNodeClient(this).connectedNodes
                .addOnSuccessListener { found -> nodes = found.map { it.id } }
        }

        if (now - sentAt < MIN_SEND_INTERVAL_MS) return
        sentAt = now

        val payload = bpm.toString().toByteArray(Charsets.UTF_8)
        val messages = Wearable.getMessageClient(this)
        for (node in nodes) messages.sendMessage(node, PATH_HEART_RATE, payload)
    }

    private fun startInForeground() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW),
        )

        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(this, CHANNEL)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.measuring))
            .setSmallIcon(R.drawable.ic_heart)
            .setContentIntent(open)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        // The paths, spelled identically in the phone's HeartRateModule.
        const val PATH_HEART_RATE = "/novafit/heart-rate"
        const val PATH_START = "/novafit/start"
        const val PATH_STOP = "/novafit/stop"

        private const val CHANNEL = "heart-rate"
        private const val NOTIFICATION_ID = 1
        private const val MIN_SEND_INTERVAL_MS = 900L
        private const val NODE_REFRESH_MS = 15_000L
        private const val MAX_SESSION_MS = 3 * 60 * 60 * 1000L

        /** For the activity, which is in the same process and has no need of a broadcast. */
        @Volatile
        var running = false
            private set

        @Volatile
        var latestBpm = 0
            private set

        @Volatile
        var latestAt = 0L
            private set

        fun start(context: Context) {
            context.startForegroundService(Intent(context, HeartRateService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, HeartRateService::class.java))
        }
    }
}
