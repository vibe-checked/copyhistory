const { withXcodeProject } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const APP_GROUP_ID = 'group.com.markutilitylabs.copyhistory';
const EXTENSION_NAME = 'SnippetsKeyboard';
const EXTENSION_BUNDLE_ID = 'com.markutilitylabs.copyhistory.SnippetsKeyboard';

const KEYBOARD_VIEW_CONTROLLER = `import UIKit

private let suiteName = "${APP_GROUP_ID}"
private let snippetsKey = "snippets"
private let recentEntriesKey = "recentEntries"
private let accentColor = UIColor(red: 0.20, green: 0.47, blue: 0.96, alpha: 1) // #3478f6

// Extensions can't reach the app's JS translation table and only need a handful
// of strings, so a tiny lookup keeps them in sync. Prefers the language chosen
// in the app (shared through the App Group); falls back to the device locale.
enum L {
  static var isArabic: Bool {
    if let code = UserDefaults(suiteName: suiteName)?.string(forKey: "uiLang"),
       !code.isEmpty {
      return code.hasPrefix("ar")
    }
    return (Locale.preferredLanguages.first ?? "en").hasPrefix("ar")
  }
  static func s(_ en: String, _ ar: String) -> String { isArabic ? ar : en }
}


private struct SharedSnippet: Codable {
  let id: String
  let label: String
  let text: String
}

private struct SharedEntry: Codable {
  let id: String
  let text: String
  let copiedAt: Double
}

class KeyboardViewController: UIInputViewController {
  // Three rows: a Recent/Snippets switcher, a strip of taller cards, then the
  // common punctuation / space / return typing row.
  private let stripHeight: CGFloat = 182
  private enum Mode { case recent, snippets }
  private var mode: Mode = .recent

  private let modeControl = UISegmentedControl(items: [L.s("Recent", "الأخيرة"), L.s("Snippets", "المقتطفات")])
  private let scrollView = UIScrollView()
  private let pillStack = UIStackView()
  private let messageLabel = UILabel()
  // Punctuation keys are hidden/shown by width so the row fits narrow phones.
  private var punctuationKeys: [UIButton] = []

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    let heightConstraint = view.heightAnchor.constraint(equalToConstant: stripHeight)
    heightConstraint.priority = .required
    heightConstraint.isActive = true
    setupLayout()
    reload()
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    markActive()
    captureClipboard()
    reload()
  }

  // Drop a marker in the shared container so the app knows the keyboard is set
  // up. Writing here only succeeds when Full Access is on (otherwise the
  // container URL is nil), so the marker's presence means "keyboard enabled AND
  // Full Access granted" — exactly what the app needs to stop nagging.
  private func markActive() {
    guard hasFullAccess,
          let dir = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: suiteName) else { return }
    try? "1".data(using: .utf8)?
      .write(to: dir.appendingPathComponent("kbd_active.txt"), options: .atomic)
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    // Refresh live: if the user copies something in the host app while the
    // keyboard stays open, poll the pasteboard so the new copy shows up in the
    // Recent tab without leaving here. UIPasteboard change notifications are
    // unreliable cross-process, so a light timer is the dependable option.
    pollTimer?.invalidate()
    pollTimer = Timer.scheduledTimer(withTimeInterval: 1.2, repeats: true) { [weak self] _ in
      guard let self = self else { return }
      let before = self.lastCapturedClip
      self.captureClipboard()
      if self.lastCapturedClip != before, self.mode == .recent { self.reload() }
    }
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    pollTimer?.invalidate()
    pollTimer = nil
  }

  private var pollTimer: Timer?

  private var lastCapturedClip: String?

  // With Full Access the keyboard can read the pasteboard directly. Capture the
  // current clipboard into the shared queue so copies made while typing land in
  // Copy History (the main app drains the queue) — no app switching needed.
  private func captureClipboard() {
    guard hasFullAccess,
          let text = UIPasteboard.general.string,
          !text.isEmpty,
          text != lastCapturedClip else { return }
    lastCapturedClip = text
    guard let dir = FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: suiteName) else { return }
    let url = dir.appendingPathComponent("pending_items.json")
    var items: [String] = []
    if let data = try? Data(contentsOf: url),
       let existing = try? JSONDecoder().decode([String].self, from: data) {
      items = existing
    }
    items.append(text)
    if items.count > 200 { items = Array(items.suffix(200)) }
    if let data = try? JSONEncoder().encode(items) {
      try? data.write(to: url, options: .atomic)
    }
  }

  // MARK: - Key factory

  // A rounded key that reads clearly in both light and dark keyboards. Accent
  // keys (return) use the app blue with white text; the rest use the adaptive
  // system fill with the primary label color.
  private func makeKey(title: String, fontSize: CGFloat = 18, accent: Bool = false) -> UIButton {
    let b = UIButton(type: .system)
    b.setTitle(title, for: .normal)
    b.titleLabel?.font = .systemFont(ofSize: fontSize, weight: accent ? .semibold : .regular)
    b.setTitleColor(accent ? .white : .label, for: .normal)
    b.backgroundColor = accent ? accentColor : UIColor.systemFill
    b.layer.cornerRadius = 7
    b.translatesAutoresizingMaskIntoConstraints = false
    b.heightAnchor.constraint(equalToConstant: 42).isActive = true
    // Shrink the label rather than truncating it — on a narrow phone "return"
    // was collapsing to "r" instead of scaling down.
    b.titleLabel?.adjustsFontSizeToFitWidth = true
    b.titleLabel?.minimumScaleFactor = 0.75
    b.titleLabel?.lineBreakMode = .byClipping
    return b
  }

  private func setupLayout() {
    // ---- Switcher: Recent <-> Snippets ----
    modeControl.selectedSegmentIndex = 0
    modeControl.selectedSegmentTintColor = accentColor
    modeControl.setTitleTextAttributes([.foregroundColor: UIColor.label], for: .normal)
    modeControl.setTitleTextAttributes([.foregroundColor: UIColor.white], for: .selected)
    modeControl.addTarget(self, action: #selector(modeChanged), for: .valueChanged)
    modeControl.translatesAutoresizingMaskIntoConstraints = false

    // ---- Card strip ----
    scrollView.translatesAutoresizingMaskIntoConstraints = false
    scrollView.showsHorizontalScrollIndicator = false

    pillStack.axis = .horizontal
    pillStack.spacing = 8
    pillStack.alignment = .fill
    pillStack.translatesAutoresizingMaskIntoConstraints = false

    messageLabel.numberOfLines = 2
    messageLabel.font = .systemFont(ofSize: 13, weight: .medium)
    messageLabel.textColor = .secondaryLabel
    messageLabel.textAlignment = .center
    messageLabel.translatesAutoresizingMaskIntoConstraints = false

    scrollView.addSubview(pillStack)
    view.addSubview(modeControl)
    view.addSubview(scrollView)
    view.addSubview(messageLabel)

    // ---- Typing row (unchanged) ----
    let bottomRow = buildBottomRow()
    view.addSubview(bottomRow)

    NSLayoutConstraint.activate([
      modeControl.topAnchor.constraint(equalTo: view.topAnchor, constant: 8),
      modeControl.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      modeControl.widthAnchor.constraint(equalToConstant: 220),
      modeControl.heightAnchor.constraint(equalToConstant: 30),

      scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 6),
      scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -6),
      scrollView.topAnchor.constraint(equalTo: modeControl.bottomAnchor, constant: 8),
      scrollView.heightAnchor.constraint(equalToConstant: 70),

      pillStack.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor, constant: 2),
      pillStack.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor, constant: -2),
      pillStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor),
      pillStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor),
      pillStack.heightAnchor.constraint(equalTo: scrollView.frameLayoutGuide.heightAnchor),

      messageLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
      messageLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
      messageLabel.centerYAnchor.constraint(equalTo: scrollView.centerYAnchor),

      bottomRow.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 6),
      bottomRow.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -6),
      bottomRow.topAnchor.constraint(equalTo: scrollView.bottomAnchor, constant: 8),
    ])
  }

  @objc private func modeChanged() {
    mode = modeControl.selectedSegmentIndex == 0 ? .recent : .snippets
    reload()
  }

  // The always-available quick-type row so users don't have to switch back to
  // the system keyboard for basic punctuation and spaces.
  private func buildBottomRow() -> UIStackView {
    let row = UIStackView()
    row.axis = .horizontal
    row.spacing = 6
    row.alignment = .fill
    row.distribution = .fill
    row.translatesAutoresizingMaskIntoConstraints = false

    // Only draw our own globe when iOS isn't already providing a switcher
    // (avoids a duplicate globe next to the system one on iPhone).
    if needsInputModeSwitchKey {
      let globe = makeKey(title: "\\u{1F310}")
      globe.addTarget(self, action: #selector(handleInputModeList(from:with:)), for: .allTouchEvents)
      pin(globe, width: 36)
      row.addArrangedSubview(globe)
    }

    // Punctuation is the only expendable part of this row. On a narrow phone
    // (iPhone SE portrait ~320pt) the full set cannot fit alongside
    // globe/space/backspace/return, so keep references and hide the extras in
    // adaptBottomRow(for:) rather than letting Auto Layout break a constraint
    // and truncate "return" down to "r".
    punctuationKeys.removeAll()
    for ch in [",", ".", "?", "!", "'"] {
      let key = makeKey(title: ch, fontSize: 20)
      pin(key, width: 30)
      key.addAction(UIAction { [weak self] _ in self?.textDocumentProxy.insertText(ch) }, for: .touchUpInside)
      punctuationKeys.append(key)
      row.addArrangedSubview(key)
    }

    // Space bar stretches to fill the remaining width.
    let space = makeKey(title: "space", fontSize: 14)
    space.setContentHuggingPriority(.defaultLow, for: .horizontal)
    space.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    space.widthAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    space.addAction(UIAction { [weak self] _ in self?.textDocumentProxy.insertText(" ") }, for: .touchUpInside)
    row.addArrangedSubview(space)

    let backspace = makeKey(title: "\\u{232B}", fontSize: 18)
    pin(backspace, width: 42)
    backspace.addTarget(self, action: #selector(backspaceTapped), for: .touchUpInside)
    row.addArrangedSubview(backspace)

    // Return must never be sacrificed — required minimum width, so it keeps its
    // full label on every screen size.
    let returnKey = makeKey(title: "return", fontSize: 15, accent: true)
    returnKey.widthAnchor.constraint(greaterThanOrEqualToConstant: 58).isActive = true
    let preferred = returnKey.widthAnchor.constraint(equalToConstant: 64)
    preferred.priority = .defaultHigh
    preferred.isActive = true
    returnKey.setContentHuggingPriority(.required, for: .horizontal)
    returnKey.setContentCompressionResistancePriority(.required, for: .horizontal)
    returnKey.addAction(UIAction { [weak self] _ in self?.textDocumentProxy.insertText("\\n") }, for: .touchUpInside)
    row.addArrangedSubview(returnKey)

    return row
  }

  // Fixed-ish width that is allowed to give way under pressure instead of
  // breaking the row's layout.
  private func pin(_ key: UIButton, width: CGFloat) {
    let c = key.widthAnchor.constraint(equalToConstant: width)
    c.priority = .defaultHigh
    c.isActive = true
    key.widthAnchor.constraint(greaterThanOrEqualToConstant: width - 6).isActive = true
    key.setContentHuggingPriority(.required, for: .horizontal)
  }

  // Drop punctuation keys that cannot fit at the current width. Called on every
  // layout pass so rotating between portrait and landscape restores them.
  private func adaptBottomRow(for width: CGFloat) {
    guard width > 0, !punctuationKeys.isEmpty else { return }
    // Roughly how much room the non-negotiable keys need.
    let reserved: CGFloat = (needsInputModeSwitchKey ? 42 : 0) + 44 + 42 + 58 + 40
    let spare = width - 16 - reserved
    let allowed = max(0, min(punctuationKeys.count, Int(spare / 36)))
    for (i, key) in punctuationKeys.enumerated() {
      let hidden = i >= allowed
      if key.isHidden != hidden { key.isHidden = hidden }
    }
  }

  override func viewWillLayoutSubviews() {
    super.viewWillLayoutSubviews()
    adaptBottomRow(for: view.bounds.width)
  }

  private func reload() {
    pillStack.arrangedSubviews.forEach { $0.removeFromSuperview() }

    guard hasFullAccess else {
      scrollView.isHidden = true
      messageLabel.isHidden = false
      messageLabel.text = L.s("Turn on Full Access (Settings \\u{203A} General \\u{203A} Keyboard \\u{203A} Keyboards) to insert snippets and recent copies.", "فعّل «الوصول الكامل» (الإعدادات \\u{203A} عام \\u{203A} لوحة المفاتيح \\u{203A} لوحات المفاتيح) لإدراج المقتطفات والنسخ الأخيرة.")
      return
    }

    switch mode {
    case .recent:
      var recents = Array(loadRecentEntries().prefix(20))
      // Show the current clipboard immediately at the top, even before the app
      // has drained the queue — so a fresh copy appears without leaving here.
      if let clip = lastCapturedClip, !clip.isEmpty, recents.first?.text != clip {
        recents.insert(SharedEntry(id: "clip", text: clip,
                                   copiedAt: Date().timeIntervalSince1970 * 1000), at: 0)
      }
      if recents.isEmpty {
        showMessage(L.s("No recent copies yet \\u{2014} copy some text and it'll show here.", "لا توجد نسخ حديثة \\u{2014} انسخ نصًا وسيظهر هنا."))
        return
      }
      messageLabel.isHidden = true
      scrollView.isHidden = false
      for entry in recents {
        pillStack.addArrangedSubview(
          makeCard(topText: relativeTime(entry.copiedAt),
                   mainText: preview(entry.text),
                   insert: entry.text, isSnippet: false))
      }
    case .snippets:
      let snippets = loadSnippets()
      if snippets.isEmpty {
        showMessage(L.s("No snippets yet \\u{2014} add some in the Copy History app under Snippets.", "لا توجد مقتطفات \\u{2014} أضفها من تطبيق سجل النسخ في قسم المقتطفات."))
        return
      }
      messageLabel.isHidden = true
      scrollView.isHidden = false
      for snippet in snippets {
        pillStack.addArrangedSubview(
          makeCard(topText: snippet.label,
                   mainText: preview(snippet.text),
                   insert: snippet.text, isSnippet: true))
      }
    }
  }

  private func showMessage(_ text: String) {
    scrollView.isHidden = true
    messageLabel.isHidden = false
    messageLabel.text = text
  }

  private func preview(_ text: String) -> String {
    text.replacingOccurrences(of: "\\n", with: " ")
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func relativeTime(_ ms: Double) -> String {
    let secs = max(0, Date().timeIntervalSince1970 - ms / 1000)
    if secs < 60 { return "now" }
    if secs < 3600 { return "\\(Int(secs / 60))m" }
    if secs < 86400 { return "\\(Int(secs / 3600))h" }
    return "\\(Int(secs / 86400))d"
  }

  // A taller, narrow card: a caption line (snippet label, or a recent's age)
  // over a two-line, ellipsized text preview. Narrow so several fit on screen.
  private func makeCard(topText: String, mainText: String, insert: String, isSnippet: Bool) -> UIButton {
    let card = UIButton(type: .system)
    card.backgroundColor = .secondarySystemFill
    card.layer.cornerRadius = 12
    card.translatesAutoresizingMaskIntoConstraints = false
    card.widthAnchor.constraint(equalToConstant: 128).isActive = true

    let top = UILabel()
    top.text = topText
    top.font = .systemFont(ofSize: 11, weight: .semibold)
    top.textColor = isSnippet ? accentColor : .secondaryLabel
    top.lineBreakMode = .byTruncatingTail
    top.translatesAutoresizingMaskIntoConstraints = false

    let main = UILabel()
    main.text = mainText
    main.font = .systemFont(ofSize: 14, weight: .regular)
    main.textColor = .label
    main.numberOfLines = 2
    main.lineBreakMode = .byTruncatingTail
    main.translatesAutoresizingMaskIntoConstraints = false

    card.addSubview(top)
    card.addSubview(main)
    NSLayoutConstraint.activate([
      top.topAnchor.constraint(equalTo: card.topAnchor, constant: 9),
      top.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 11),
      top.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -11),
      main.topAnchor.constraint(equalTo: top.bottomAnchor, constant: 3),
      main.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 11),
      main.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -11),
    ])
    card.addAction(UIAction { [weak self] _ in
      self?.textDocumentProxy.insertText(insert)
    }, for: .touchUpInside)
    return card
  }

  private func loadSnippets() -> [SharedSnippet] {
    guard let defaults = UserDefaults(suiteName: suiteName),
          let json = defaults.string(forKey: snippetsKey),
          let data = json.data(using: .utf8) else { return [] }
    return (try? JSONDecoder().decode([SharedSnippet].self, from: data)) ?? []
  }

  private func loadRecentEntries() -> [SharedEntry] {
    guard let defaults = UserDefaults(suiteName: suiteName),
          let json = defaults.string(forKey: recentEntriesKey),
          let data = json.data(using: .utf8) else { return [] }
    return (try? JSONDecoder().decode([SharedEntry].self, from: data)) ?? []
  }

  @objc private func backspaceTapped() {
    textDocumentProxy.deleteBackward()
  }
}
`;

const buildInfoPlist = (version, build) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>Snippets Keyboard</string>
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
    <key>NSExtensionAttributes</key>
    <dict>
      <key>IsASCIICapable</key>
      <true/>
      <key>PrimaryLanguage</key>
      <string>en-US</string>
      <key>PrefersRightToLeft</key>
      <false/>
      <key>RequestsOpenAccess</key>
      <true/>
    </dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.keyboard-service</string>
    <key>NSExtensionPrincipalClass</key>
    <string>$(PRODUCT_MODULE_NAME).KeyboardViewController</string>
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

module.exports = function withKeyboardExtension(config) {
  config = withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const iosPath = mod.modRequest.platformProjectRoot;

    const nativeTargets = project.pbxNativeTargetSection();
    if (Object.values(nativeTargets).some(t => t && typeof t === 'object' && t.name === EXTENSION_NAME)) {
      return mod;
    }

    const extDir = path.join(iosPath, EXTENSION_NAME);
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(path.join(extDir, 'KeyboardViewController.swift'), KEYBOARD_VIEW_CONTROLLER);
    fs.writeFileSync(
      path.join(extDir, 'Info.plist'),
      buildInfoPlist(config.version || '1.0.0', String(config.ios?.buildNumber ?? '1')),
    );
    fs.writeFileSync(path.join(extDir, `${EXTENSION_NAME}.entitlements`), ENTITLEMENTS);

    const target = project.addTarget(EXTENSION_NAME, 'app_extension', EXTENSION_NAME, EXTENSION_BUNDLE_ID);
    const targetUUID = target.uuid;
    const productRefUUID = target.pbxNativeTarget.productReference;

    project.addBuildPhase(
      [`${EXTENSION_NAME}/KeyboardViewController.swift`],
      'PBXSourcesBuildPhase',
      'Sources',
      targetUUID
    );

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
        IPHONEOS_DEPLOYMENT_TARGET: '15.1',
        LD_RUNPATH_SEARCH_PATHS: '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
        PRODUCT_BUNDLE_IDENTIFIER: `"${EXTENSION_BUNDLE_ID}"`,
        PRODUCT_NAME: '"$(TARGET_NAME)"',
        SKIP_INSTALL: 'YES',
        SWIFT_VERSION: '5.0',
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
          phase.name = '"Embed App Extensions"';
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
