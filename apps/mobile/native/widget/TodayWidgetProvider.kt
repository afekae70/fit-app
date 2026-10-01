package com.afeka.fitapp.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.afeka.fitapp.MainActivity
import com.afeka.fitapp.R
import org.json.JSONObject
import java.io.File

/**
 * Today's workout on the home screen, with a tap that opens the app.
 *
 * It reads `widget.json`, which the app writes into its own files directory whenever the home
 * screen loads. Deliberately not the database: the launcher would be a second process reading a
 * SQLite file the app keeps open, and all of this is for a label that changes once a day.
 *
 * Everything is defensive. A missing file, a half-written one, a shape from an older version of
 * the app — any of them render the resting state rather than throwing inside the launcher, which
 * is a crash the user sees as their home screen misbehaving.
 */
class TodayWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        val snapshot = readSnapshot(context)

        for (id in appWidgetIds) {
            val views = RemoteViews(context.packageName, R.layout.today_widget)

            views.setTextViewText(R.id.widget_title, snapshot.title)
            views.setTextViewText(R.id.widget_detail, snapshot.detail)
            views.setTextViewText(R.id.widget_action, snapshot.action)

            // The whole slab opens the app — a widget with one tiny target is a widget nobody
            // hits on the first try.
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pending = PendingIntent.getActivity(
                context,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.widget_root, pending)

            appWidgetManager.updateAppWidget(id, views)
        }
    }

    private data class Snapshot(val title: String, val detail: String, val action: String)

    private fun readSnapshot(context: Context): Snapshot {
        val fallback = Snapshot(
            context.getString(R.string.widget_rest_title),
            context.getString(R.string.widget_rest_detail),
            context.getString(R.string.widget_open),
        )
        return try {
            val file = File(context.filesDir, "widget.json")
            if (!file.exists()) return fallback
            val json = JSONObject(file.readText())
            val title = json.optString("title").ifBlank { return fallback }
            Snapshot(
                title,
                json.optString("detail"),
                json.optString("action").ifBlank { context.getString(R.string.widget_start) },
            )
        } catch (_: Exception) {
            fallback
        }
    }
}
