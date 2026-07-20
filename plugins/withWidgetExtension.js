const { withXcodeProject } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const APP_GROUP_ID = 'group.com.markutilitylabs.copyhistory';
const EXTENSION_NAME = 'CopyHistoryWidgets';
const EXTENSION_BUNDLE_ID = 'com.markutilitylabs.copyhistory.CopyHistoryWidgets';
// Matches the host app so the widgets also show up for iOS 15/16 users. The
// interactive bits (AppIntents / Button(intent:) / containerBackground) are all
// iOS 16-17 only, so they are gated behind #available and AppIntents is
// WEAK-linked — on older systems the widget renders read-only and tapping it
// opens the app instead of copying in place.
const WIDGET_DEPLOYMENT_TARGET = '15.1';

const SHARED_MODELS = `import Foundation

struct SharedSnippet: Codable, Identifiable {
  let id: String
  let label: String
  let text: String
}

struct SharedEntry: Codable, Identifiable {
  let id: String
  let text: String
  let copiedAt: Double
}

let appGroupSuiteName = "${APP_GROUP_ID}"

func loadSharedSnippets() -> [SharedSnippet] {
  guard let defaults = UserDefaults(suiteName: appGroupSuiteName),
        let json = defaults.string(forKey: "snippets"),
        let data = json.data(using: .utf8) else { return [] }
  return (try? JSONDecoder().decode([SharedSnippet].self, from: data)) ?? []
}

func loadSharedEntries() -> [SharedEntry] {
  guard let defaults = UserDefaults(suiteName: appGroupSuiteName),
        let json = defaults.string(forKey: "recentEntries"),
        let data = json.data(using: .utf8) else { return [] }
  return (try? JSONDecoder().decode([SharedEntry].self, from: data)) ?? []
}
`;

const COPY_TEXT_INTENT = `import AppIntents
import UIKit

// AppIntents only exists on iOS 16+. The framework is weak-linked, so this type
// must never be touched on older systems — every use site is behind
// #available(iOS 17) (Button(intent:) itself needs 17).
@available(iOS 16.0, *)
struct CopyTextIntent: AppIntent {
  static var title: LocalizedStringResource = "Copy Text"
  static var description = IntentDescription("Copies the selected text to the clipboard.")

  @Parameter(title: "Text")
  var text: String

  init() {
    self.text = ""
  }

  init(text: String) {
    self.text = text
  }

  func perform() async throws -> some IntentResult {
    UIPasteboard.general.string = text
    return .result()
  }
}
`;

const WIDGET_COMPAT = `import SwiftUI
import WidgetKit

// Widget strings follow the language picked in the app (shared via App Group),
// falling back to the device locale.
enum L {
  static var isArabic: Bool {
    if let code = UserDefaults(suiteName: "group.com.markutilitylabs.copyhistory")?
      .string(forKey: "uiLang"), !code.isEmpty { return code.hasPrefix("ar") }
    return (Locale.preferredLanguages.first ?? "en").hasPrefix("ar")
  }
  static func s(_ en: String, _ ar: String) -> String { isArabic ? ar : en }
}

// One place for every "this API is too new" decision, so the widget bodies stay
// readable and iOS 15/16 never touches an unavailable symbol.
extension View {
  // containerBackground is iOS 17+; older systems paint the background directly.
  @ViewBuilder
  func chWidgetBackground() -> some View {
    if #available(iOS 17.0, *) {
      self.containerBackground(.fill.tertiary, for: .widget)
    } else {
      self.background(Color(UIColor.systemBackground))
    }
  }
}

// Tap-to-copy needs interactive widgets (iOS 17+). Below that the row is plain
// and the whole widget deep-links into the app via .widgetURL instead.
@ViewBuilder
func chCopyRow<Content: View>(text: String, @ViewBuilder content: @escaping () -> Content) -> some View {
  if #available(iOS 17.0, *) {
    Button(intent: CopyTextIntent(text: text)) { content() }
      .buttonStyle(.plain)
  } else {
    content()
  }
}
`;

const SNIPPETS_WIDGET = `import WidgetKit
import SwiftUI

struct SnippetsEntry: TimelineEntry {
  let date: Date
  let snippets: [SharedSnippet]
}

struct SnippetsProvider: TimelineProvider {
  func placeholder(in context: Context) -> SnippetsEntry {
    SnippetsEntry(date: Date(), snippets: [SharedSnippet(id: "1", label: "Email", text: "you@example.com")])
  }

  func getSnapshot(in context: Context, completion: @escaping (SnippetsEntry) -> Void) {
    completion(SnippetsEntry(date: Date(), snippets: loadSharedSnippets()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<SnippetsEntry>) -> Void) {
    let entry = SnippetsEntry(date: Date(), snippets: loadSharedSnippets())
    completion(Timeline(entries: [entry], policy: .never))
  }
}

struct SnippetsWidgetView: View {
  @Environment(\\.widgetFamily) var family
  let entry: SnippetsEntry

  private var limit: Int {
    switch family {
    case .systemSmall: return 1
    case .systemMedium: return 3
    default: return 6
    }
  }

  var body: some View {
    let items = Array(entry.snippets.prefix(limit))
    VStack(alignment: .leading, spacing: 6) {
      Text(L.s("SNIPPETS", "المقتطفات"))
        .font(.caption2)
        .fontWeight(.bold)
        .foregroundStyle(.secondary)
      if items.isEmpty {
        Text(L.s("No snippets yet", "لا توجد مقتطفات بعد"))
          .font(.caption)
          .foregroundStyle(.secondary)
        Spacer()
      } else {
        ForEach(Array(items.enumerated()), id: \\.element.id) { index, snippet in
          chCopyRow(text: snippet.text) {
            VStack(alignment: .leading, spacing: 1) {
              Text(snippet.label)
                .font(.subheadline)
                .fontWeight(.semibold)
                .foregroundStyle(.primary)
              Text(snippet.text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
          }
          if index < items.count - 1 { Divider() }
        }
      }
    }
    .padding()
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .chWidgetBackground()
    .widgetURL(URL(string: "copyhistory://snippets"))
  }
}

struct SnippetsWidget: Widget {
  let kind: String = "SnippetsWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: SnippetsProvider()) { entry in
      SnippetsWidgetView(entry: entry)
    }
    .configurationDisplayName(L.s("Saved Snippets", "المقتطفات المحفوظة"))
    .description(L.s("Tap a snippet to copy it instantly.", "اضغط أي مقتطف لنسخه فورًا."))
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}
`;

const HISTORY_WIDGET = `import WidgetKit
import SwiftUI

struct HistoryEntry: TimelineEntry {
  let date: Date
  let items: [SharedEntry]
}

struct HistoryProvider: TimelineProvider {
  func placeholder(in context: Context) -> HistoryEntry {
    HistoryEntry(date: Date(), items: [])
  }

  func getSnapshot(in context: Context, completion: @escaping (HistoryEntry) -> Void) {
    completion(HistoryEntry(date: Date(), items: loadSharedEntries()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<HistoryEntry>) -> Void) {
    let entry = HistoryEntry(date: Date(), items: loadSharedEntries())
    completion(Timeline(entries: [entry], policy: .never))
  }
}

struct HistoryWidgetView: View {
  @Environment(\\.widgetFamily) var family
  let entry: HistoryEntry

  private var limit: Int {
    switch family {
    case .systemSmall: return 1
    case .systemMedium: return 3
    default: return 6
    }
  }

  var body: some View {
    let items = Array(entry.items.prefix(limit))
    VStack(alignment: .leading, spacing: 6) {
      Text(L.s("HISTORY", "السجل"))
        .font(.caption2)
        .fontWeight(.bold)
        .foregroundStyle(.secondary)
      if items.isEmpty {
        Text(L.s("No copies yet", "لا توجد نسخ بعد"))
          .font(.caption)
          .foregroundStyle(.secondary)
        Spacer()
      } else {
        ForEach(Array(items.enumerated()), id: \\.element.id) { index, item in
          chCopyRow(text: item.text) {
            Text(item.text)
              .font(.caption)
              .foregroundStyle(.primary)
              .lineLimit(2)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          if index < items.count - 1 { Divider() }
        }
      }
    }
    .padding()
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .chWidgetBackground()
    .widgetURL(URL(string: "copyhistory://history"))
  }
}

struct HistoryWidget: Widget {
  let kind: String = "HistoryWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: HistoryProvider()) { entry in
      HistoryWidgetView(entry: entry)
    }
    .configurationDisplayName(L.s("Recent History", "السجل الأخير"))
    .description(L.s("Tap a copied item to copy it again instantly.", "اضغط أي عنصر منسوخ لنسخه مجددًا."))
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}
`;

const WIDGET_BUNDLE = `import WidgetKit
import SwiftUI

@main
struct CopyHistoryWidgetsBundle: WidgetBundle {
  var body: some Widget {
    SnippetsWidget()
    HistoryWidget()
  }
}
`;

const buildInfoPlist = (version, build) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>Copy History</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>XPC!</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundleVersion</key>
  <string>${build}</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.widgetkit-extension</string>
  </dict>
</dict>
</plist>
`;

const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${APP_GROUP_ID}</string>
  </array>
</dict>
</plist>
`;

module.exports = function withWidgetExtension(config) {
  config = withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const iosPath = mod.modRequest.platformProjectRoot;

    const nativeTargets = project.pbxNativeTargetSection();
    if (Object.values(nativeTargets).some(t => t && typeof t === 'object' && t.name === EXTENSION_NAME)) {
      return mod;
    }

    const extDir = path.join(iosPath, EXTENSION_NAME);
    fs.mkdirSync(extDir, { recursive: true });
    const sourceFiles = {
      'SharedModels.swift': SHARED_MODELS,
      'WidgetCompat.swift': WIDGET_COMPAT,
      'CopyTextIntent.swift': COPY_TEXT_INTENT,
      'SnippetsWidget.swift': SNIPPETS_WIDGET,
      'HistoryWidget.swift': HISTORY_WIDGET,
      'CopyHistoryWidgetsBundle.swift': WIDGET_BUNDLE,
    };
    Object.entries(sourceFiles).forEach(([name, contents]) => {
      fs.writeFileSync(path.join(extDir, name), contents);
    });
    fs.writeFileSync(
      path.join(extDir, 'Info.plist'),
      buildInfoPlist(config.version || '1.0.0', String(config.ios?.buildNumber ?? '1')),
    );
    fs.writeFileSync(path.join(extDir, `${EXTENSION_NAME}.entitlements`), ENTITLEMENTS);

    const target = project.addTarget(EXTENSION_NAME, 'app_extension', EXTENSION_NAME, EXTENSION_BUNDLE_ID);
    const targetUUID = target.uuid;
    const productRefUUID = target.pbxNativeTarget.productReference;

    project.addBuildPhase(
      Object.keys(sourceFiles).map((name) => `${EXTENSION_NAME}/${name}`),
      'PBXSourcesBuildPhase',
      'Sources',
      targetUUID
    );

    // The widget target needs its OWN Frameworks build phase before linking:
    // node-xcode's addFramework falls back to the FIRST target's Frameworks
    // phase when the requested target has none. That silently linked
    // AppIntents.framework (iOS 16+) into the MAIN APP, which targets iOS 15.1
    // — so dyld killed the app at launch on every iOS 15 device.
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', targetUUID);

    // AppIntents is iOS 16+ and this target now deploys to 15.1, so it must be
    // WEAK-linked (via OTHER_LDFLAGS below) — a strong link would stop the
    // extension loading on iOS 15, the same class of bug that crashed the app.
    ['WidgetKit.framework', 'SwiftUI.framework'].forEach((framework) => {
      try {
        project.addFramework(framework, { target: targetUUID });
      } catch (e) {
        console.warn(`[withWidgetExtension] Failed to link ${framework}: ${e.message}`);
      }
    });

    const objects = project.hash.project.objects;
    const configListUUID = target.pbxNativeTarget.buildConfigurationList;
    const configList = objects['XCConfigurationList'][configListUUID];
    configList.buildConfigurations.forEach(({ value: configUUID }) => {
      const cfg = objects['XCBuildConfiguration'][configUUID];
      if (!cfg) return;
      Object.assign(cfg.buildSettings, {
        CODE_SIGN_ENTITLEMENTS: `"${EXTENSION_NAME}/${EXTENSION_NAME}.entitlements"`,
        CODE_SIGN_STYLE: 'Automatic',
        GENERATE_INFOPLIST_FILE: 'NO',
        INFOPLIST_FILE: `"${EXTENSION_NAME}/Info.plist"`,
        IPHONEOS_DEPLOYMENT_TARGET: WIDGET_DEPLOYMENT_TARGET,
        // Weak so the extension still loads on iOS 15, where AppIntents is
        // absent. Must be a pbxproj LIST — a single quoted string here produces
        // an unparseable project file.
        OTHER_LDFLAGS: ['"$(inherited)"', '"-weak_framework"', '"AppIntents"'],
        LD_RUNPATH_SEARCH_PATHS: '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
        PRODUCT_BUNDLE_IDENTIFIER: `"${EXTENSION_BUNDLE_ID}"`,
        PRODUCT_NAME: '"$(TARGET_NAME)"',
        SKIP_INSTALL: 'YES',
        SWIFT_VERSION: '5.0',
        SWIFT_EMIT_LOC_STRINGS: 'YES',
        TARGETED_DEVICE_FAMILY: '"1,2"',
      });
    });

    const copyFilesSection = objects['PBXCopyFilesBuildPhase'];
    const buildFilesSection = objects['PBXBuildFile'];
    if (copyFilesSection && buildFilesSection) {
      Object.values(copyFilesSection).forEach((phase) => {
        if (!phase || typeof phase !== 'object' || !Array.isArray(phase.files)) return;
        const hasOurProduct = phase.files.some((f) => {
          const bf = buildFilesSection[f.value];
          return bf && bf.fileRef === productRefUUID;
        });
        if (hasOurProduct && phase.dstSubfolderSpec === 13) {
          phase.name = '"Embed Foundation Extensions"';
          phase.files.forEach((f) => {
            const bf = buildFilesSection[f.value];
            if (bf && bf.fileRef === productRefUUID) {
              bf.settings = bf.settings || {};
              if (!Array.isArray(bf.settings.ATTRIBUTES)) bf.settings.ATTRIBUTES = [];
              if (!bf.settings.ATTRIBUTES.includes('RemoveHeadersOnCopy')) {
                bf.settings.ATTRIBUTES.push('RemoveHeadersOnCopy');
              }
            }
          });
        }
      });
    }

    return mod;
  });

  return config;
};
