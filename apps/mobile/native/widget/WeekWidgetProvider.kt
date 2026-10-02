package com.afeka.fitapp.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.content.Intent
import android.widget.RemoteViews
import com.afeka.fitapp.MainActivity
import com.afeka.fitapp.R
import org.json.JSONObject
import java.io.File

/**
 * The week on the home screen: workouts done against the week's target, as a ring.
 *
 * The same `widget.json` the other widget reads, under a `week` key — written by the app whenever
 * the home screen loads, so this is never a second reader of the database.
 *
 * The ring is drawn here, into a bitmap, because `RemoteViews` has no arc: the launcher can be
 * handed a finished image but not a drawing instruction. Everything about *what* to draw — how
 * full the ring is, what the figure in the middle says — is decided in the app and tested there;
 * this file only turns a percentage into pixels.
 */
class WeekWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        val week = readWeek(context)

        for (id in appWidgetIds) {
            val views = RemoteViews(context.packageName, R.layout.week_widget)

            views.setImageViewBitmap(R.id.week_ring, drawRing(context, week.percent, week.count))
            views.setTextViewText(R.id.week_caption, week.caption)
            views.setTextViewText(R.id.week_streak, week.streak)
            // An empty streak leaves a gap where a line used to be, so the view goes with it.
            views.setViewVisibility(
                R.id.week_streak,
                if (week.streak.isBlank()) android.view.View.GONE else android.view.View.VISIBLE,
            )

            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pending = PendingIntent.getActivity(
                context,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.week_root, pending)

            appWidgetManager.updateAppWidget(id, views)
        }
    }

    private data class Week(
        val percent: Int,
        val count: String,
        val caption: String,
        val streak: String,
    )

    private fun readWeek(context: Context): Week {
        val fallback = Week(
            0,
            "0/0",
            context.getString(R.string.widget_week_caption),
            "",
        )
        return try {
            val file = File(context.filesDir, "widget.json")
            if (!file.exists()) return fallback
            val week = JSONObject(file.readText()).optJSONObject("week") ?: return fallback
            Week(
                week.optInt("percent", 0).coerceIn(0, 100),
                week.optString("count").ifBlank { fallback.count },
                week.optString("caption").ifBlank { fallback.caption },
                week.optString("streak"),
            )
        } catch (_: Exception) {
            fallback
        }
    }

    /**
     * The ring itself: a full track, the done part over it, and the figure in the middle.
     *
     * Drawn at a fixed size and left to the ImageView to scale — a widget is resizable and the
     * launcher may hand this to a 40dp box or a 90dp one, and one crisp bitmap scaled down beats
     * measuring the host and getting it wrong. It starts at twelve o'clock and goes clockwise,
     * which is the direction a ring is read in regardless of the language around it.
     */
    private fun drawRing(context: Context, percent: Int, count: String): Bitmap {
        val size = 144
        val stroke = 14f
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val box = RectF(stroke / 2f, stroke / 2f, size - stroke / 2f, size - stroke / 2f)

        val track = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = stroke
            color = context.getColor(R.color.widget_edge)
        }
        canvas.drawArc(box, 0f, 360f, false, track)

        if (percent > 0) {
            val arc = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE
                strokeWidth = stroke
                strokeCap = Paint.Cap.ROUND
                color = context.getColor(R.color.widget_accent)
            }
            canvas.drawArc(box, -90f, 360f * percent / 100f, false, arc)
        }

        val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = context.getColor(R.color.widget_text)
            textAlign = Paint.Align.CENTER
            textSize = 44f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }
        // Centred on the ink rather than on the baseline: text drawn at size / 2 sits a third of a
        // line too low inside a circle, which is the kind of thing only a ring makes obvious.
        val metrics = text.fontMetrics
        val baseline = size / 2f - (metrics.ascent + metrics.descent) / 2f
        canvas.drawText(count, size / 2f, baseline, text)

        return bitmap
    }
}
