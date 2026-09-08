// Ledgeur's home-screen and lock-screen widgets.
//
// ── What a widget is allowed to be ──────────────────────────────────────────
// A widget cannot run the app's code, reach its database or record anything. It
// renders, and it can ask the system to open a URL. That is the whole surface,
// and it is exactly enough for the thing that matters: getting from a locked
// phone to a live microphone in one tap.
//
// So there is no data here, and deliberately no attempt to show any. A widget
// that promised "3 open tasks" would need an app group, a shared container and
// a write on every change, and it would still be wrong for the minutes between
// refreshes. This is a button. It is honest about being a button.
//
// ── The URLs are a contract ─────────────────────────────────────────────────
// Each one is parsed by `parseCaptureLink` in apps/desktop/src/lib/captureLinks.ts
// and pinned by a test there. Changing a string on this side without changing
// that one is a tap that silently does nothing on somebody's lock screen —
// which is the kind of bug nobody reports, they just stop using the widget.
//
// ── Why this extension deploys to iOS 16 and the app to 14 ──────────────────
// The lock-screen (accessory) families do not exist before iOS 16, and a
// lock-screen button is most of the point of this. An extension may ask for a
// newer system than its host app: on iOS 14 and 15 the app works exactly as it
// does today and the widget simply is not offered.

import SwiftUI
import WidgetKit

// MARK: - Links

enum LedgeurLink {
    /// Open the capture box, ready to type.
    static let capture = URL(string: "ledgeur://capture")!
    /// Open the capture box and start listening straight away.
    static let speak = URL(string: "ledgeur://capture?mode=speak")!
    /// Start recording a meeting.
    static let record = URL(string: "ledgeur://record")!
}

// MARK: - Timeline

/// There is nothing to schedule: the widget shows the same thing forever, so it
/// asks the system never to wake it again. A `.never` policy costs the battery
/// nothing and cannot go stale, because there is nothing in it that can.
struct LedgeurEntry: TimelineEntry {
    let date: Date
}

struct LedgeurProvider: TimelineProvider {
    func placeholder(in context: Context) -> LedgeurEntry {
        LedgeurEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (LedgeurEntry) -> Void) {
        completion(LedgeurEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<LedgeurEntry>) -> Void) {
        completion(Timeline(entries: [LedgeurEntry(date: Date())], policy: .never))
    }
}

// MARK: - Shared pieces

private struct WidgetBackground: ViewModifier {
    func body(content: Content) -> some View {
        // iOS 17 requires an explicit container background or the widget draws
        // on nothing and reads as a rendering bug. Older systems must not get
        // the call at all.
        if #available(iOS 17.0, *) {
            return AnyView(content.containerBackground(.fill.tertiary, for: .widget))
        } else {
            return AnyView(content.padding())
        }
    }
}

private extension View {
    func ledgeurWidgetBackground() -> some View { modifier(WidgetBackground()) }
}

/// One tappable action on the home screen.
private struct ActionTile: View {
    let title: String
    let symbol: String
    let url: URL
    var prominent: Bool = false

    var body: some View {
        Link(destination: url) {
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: symbol)
                    .font(.system(size: 18, weight: .semibold))
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .padding(10)
            .background(prominent ? Color.accentColor.opacity(0.16) : Color.primary.opacity(0.06))
            .foregroundColor(.primary)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }
}

// MARK: - Views

struct LedgeurWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: LedgeurEntry

    var body: some View {
        switch family {
        case .systemMedium:
            medium.ledgeurWidgetBackground()
        // The lock screen: one tap, straight to a listening microphone. There
        // is no room for a choice here and no need for one — somebody reaching
        // for their lock screen is not planning to type.
        case .accessoryCircular:
            circular.ledgeurWidgetBackground()
        case .accessoryRectangular:
            rectangular.ledgeurWidgetBackground()
        default:
            small.ledgeurWidgetBackground()
        }
    }

    /// Small: the single most valuable action, whole-widget tappable.
    private var small: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: "mic.fill")
                .font(.system(size: 22, weight: .semibold))
                .foregroundColor(.accentColor)
            Spacer(minLength: 0)
            Text("Keep a thought")
                .font(.system(size: 15, weight: .semibold))
            Text("Say it — it is kept and sorted.")
                .font(.system(size: 11))
                .foregroundColor(.secondary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetURL(LedgeurLink.speak)
    }

    /// Medium: room for the three real choices, each its own target.
    private var medium: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Ledgeur")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(.secondary)
            HStack(spacing: 8) {
                ActionTile(title: "Say it", symbol: "mic.fill", url: LedgeurLink.speak, prominent: true)
                ActionTile(title: "Type it", symbol: "square.and.pencil", url: LedgeurLink.capture)
                ActionTile(title: "Record", symbol: "waveform", url: LedgeurLink.record)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var circular: some View {
        ZStack {
            AccessoryWidgetBackground()
            Image(systemName: "mic.fill")
                .font(.system(size: 18, weight: .semibold))
        }
        .widgetURL(LedgeurLink.speak)
    }

    private var rectangular: some View {
        HStack(spacing: 6) {
            Image(systemName: "mic.fill")
                .font(.system(size: 14, weight: .semibold))
            VStack(alignment: .leading, spacing: 1) {
                Text("Keep a thought")
                    .font(.system(size: 13, weight: .semibold))
                Text("Tap to say it")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
            }
            Spacer(minLength: 0)
        }
        .widgetURL(LedgeurLink.speak)
    }
}

// MARK: - Widget

struct LedgeurCaptureWidget: Widget {
    private let kind = "LedgeurCapture"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LedgeurProvider()) { entry in
            LedgeurWidgetView(entry: entry)
        }
        .configurationDisplayName("Keep a thought")
        .description("Catch a thought before it goes. Say it or type it, and Ledgeur sorts it.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
    }
}

@main
struct LedgeurWidgetBundle: WidgetBundle {
    var body: some Widget {
        LedgeurCaptureWidget()
    }
}
