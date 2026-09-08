package com.maxbeech.ledgeur

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/**
 * Ledgeur's home-screen widget.
 *
 * ## What a widget is allowed to be
 * A widget cannot run the app's code, read its database or record anything. It
 * renders a fixed layout and it can ask the system to open a URL. That is the
 * whole surface, and it is exactly enough for the thing that matters: getting
 * from a locked phone to a live microphone in one tap.
 *
 * So there is no data here, and deliberately no attempt to show any. A widget
 * that promised "3 open tasks" would need a shared store, a write on every
 * change and a refresh budget, and it would still be wrong for the minutes
 * between updates. This is a set of buttons, and it is honest about that —
 * which is also why it never needs to refresh (see the `.never`-equivalent:
 * `updatePeriodMillis="0"` in capture_widget_info.xml).
 *
 * ## The URLs are a contract
 * Each one is parsed by `parseCaptureLink` in
 * apps/desktop/src/lib/captureLinks.ts and pinned by a test there. Changing a
 * string on this side without changing that one is a tap that silently does
 * nothing on somebody's home screen — the kind of bug nobody reports, they
 * just stop using the widget.
 */
class CaptureWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        val views = build(context)
        for (id in appWidgetIds) manager.updateAppWidget(id, views)
    }

    private fun build(context: Context): RemoteViews =
        RemoteViews(context.packageName, R.layout.widget_capture).apply {
            setOnClickPendingIntent(R.id.widget_speak, open(context, SPEAK, REQUEST_SPEAK))
            setOnClickPendingIntent(R.id.widget_type, open(context, CAPTURE, REQUEST_TYPE))
            setOnClickPendingIntent(R.id.widget_record, open(context, RECORD, REQUEST_RECORD))
        }

    /**
     * A tap, as a pending intent.
     *
     * `setPackage` keeps the link inside this app: without it a URL this app
     * declares could in principle be offered to a chooser, and a widget that
     * opens a dialog has already lost the two seconds it exists to save.
     *
     * Each action needs its own request code. Pending intents that differ only
     * by their extras are considered equal, so three intents sharing a code
     * would collapse into whichever was created first — every button opening
     * the microphone, or none of them doing what it says.
     */
    private fun open(context: Context, url: String, requestCode: Int): PendingIntent {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            setPackage(context.packageName)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            // IMMUTABLE is required from Android 12 and harmless before it.
            // Nothing here needs to fill anything in later.
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private companion object {
        const val CAPTURE = "ledgeur://capture"
        const val SPEAK = "ledgeur://capture?mode=speak"
        const val RECORD = "ledgeur://record"

        const val REQUEST_SPEAK = 1
        const val REQUEST_TYPE = 2
        const val REQUEST_RECORD = 3
    }
}
