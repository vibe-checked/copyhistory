const { withXcodeProject, withEntitlementsPlist } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const APP_GROUP_ID = 'group.com.markutilitylabs.copyhistory';
const EXTENSION_NAME = 'CopyToClipboardExtension';
const EXTENSION_BUNDLE_ID = 'com.markutilitylabs.copyhistory.CopyToClipboardExtension';

const VIEW_CONTROLLER = `import UIKit

class CopyToClipboardViewController: UIViewController {
  private let suiteName = "${APP_GROUP_ID}"
  private let pendingFileName = "pending_items.json"

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor.black.withAlphaComponent(0.28)
    let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
    // Text may live in an attachment OR directly on the share item.
    let fallback = items.compactMap { $0.attributedContentText?.string }
      .first(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
    let providers = items.flatMap { $0.attachments ?? [] }
    tryProviders(providers, index: 0, fallback: fallback)
  }

  private func tryProviders(_ providers: [NSItemProvider], index: Int, fallback: String?) {
    guard index < providers.count else {
      // No attachment yielded text — use the share item's own text if any.
      if let f = fallback, !f.isEmpty {
        capture(text: f); finish(saved: true)
      } else {
        finish(saved: false)
      }
      return
    }
    let provider = providers[index]
    let urlType = "public.url"
    let textTypes = ["public.plain-text", "public.utf8-plain-text", "public.text"]

    if provider.hasItemConformingToTypeIdentifier(urlType) {
      provider.loadItem(forTypeIdentifier: urlType) { [weak self] data, _ in
        let text = (data as? URL)?.absoluteString ?? (data as? String) ?? ""
        if !text.isEmpty { self?.capture(text: text); self?.finish(saved: true) }
        else { self?.tryProviders(providers, index: index + 1, fallback: fallback) }
      }
    } else if let t = textTypes.first(where: { provider.hasItemConformingToTypeIdentifier($0) }) {
      provider.loadItem(forTypeIdentifier: t) { [weak self] data, _ in
        let text = (data as? String)
          ?? (data as? NSAttributedString)?.string
          ?? (data as? Data).flatMap { String(data: $0, encoding: .utf8) }
          ?? ""
        if !text.isEmpty { self?.capture(text: text); self?.finish(saved: true) }
        else { self?.tryProviders(providers, index: index + 1, fallback: fallback) }
      }
    } else {
      tryProviders(providers, index: index + 1, fallback: fallback)
    }
  }

  private func capture(text: String) {
    // Put it on the system pasteboard so it can be pasted right away...
    UIPasteboard.general.string = text
    // ...and ALSO append it to a shared App Group FILE so it reliably lands in
    // Copy History even if the user copies something else before opening the
    // app. A file (not UserDefaults) is used because the long-lived app process
    // caches a stale view of a UserDefaults suite written by an extension.
    guard let dir = FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: suiteName) else { return }
    let fileURL = dir.appendingPathComponent(pendingFileName)
    var items: [String] = []
    if let data = try? Data(contentsOf: fileURL),
       let existing = try? JSONDecoder().decode([String].self, from: data) {
      items = existing
    }
    items.append(text)
    if items.count > 200 { items = Array(items.suffix(200)) }
    if let data = try? JSONEncoder().encode(items) {
      try? data.write(to: fileURL, options: .atomic)
    }
  }

  private func finish(saved: Bool) {
    DispatchQueue.main.async {
      guard saved else {
        self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        return
      }
      self.showSavedCard()
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
        self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
      }
    }
  }

  // A small centered "Saved!" confirmation card (green check) that springs in,
  // giving immediate feedback that the item was captured before we dismiss.
  private func showSavedCard() {
    let card = UIView()
    card.backgroundColor = UIColor(red: 0.17, green: 0.17, blue: 0.18, alpha: 1)
    card.layer.cornerRadius = 20
    card.translatesAutoresizingMaskIntoConstraints = false
    card.alpha = 0
    card.transform = CGAffineTransform(scaleX: 0.85, y: 0.85)

    let circle = UIView()
    circle.backgroundColor = UIColor(red: 0.20, green: 0.78, blue: 0.35, alpha: 1)
    circle.layer.cornerRadius = 28
    circle.translatesAutoresizingMaskIntoConstraints = false

    let check = UIImageView(
      image: UIImage(systemName: "checkmark",
                     withConfiguration: UIImage.SymbolConfiguration(pointSize: 26, weight: .bold)))
    check.tintColor = .white
    check.contentMode = .center
    check.translatesAutoresizingMaskIntoConstraints = false

    let label = UILabel()
    label.text = "Saved!"
    label.textColor = .white
    label.font = .systemFont(ofSize: 20, weight: .bold)
    label.translatesAutoresizingMaskIntoConstraints = false

    circle.addSubview(check)
    card.addSubview(circle)
    card.addSubview(label)
    view.addSubview(card)

    NSLayoutConstraint.activate([
      card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      card.widthAnchor.constraint(equalToConstant: 184),
      card.heightAnchor.constraint(equalToConstant: 152),

      circle.topAnchor.constraint(equalTo: card.topAnchor, constant: 30),
      circle.centerXAnchor.constraint(equalTo: card.centerXAnchor),
      circle.widthAnchor.constraint(equalToConstant: 56),
      circle.heightAnchor.constraint(equalToConstant: 56),

      check.centerXAnchor.constraint(equalTo: circle.centerXAnchor),
      check.centerYAnchor.constraint(equalTo: circle.centerYAnchor),

      label.topAnchor.constraint(equalTo: circle.bottomAnchor, constant: 16),
      label.centerXAnchor.constraint(equalTo: card.centerXAnchor),
    ])

    UIView.animate(withDuration: 0.28, delay: 0,
                   usingSpringWithDamping: 0.7, initialSpringVelocity: 0.5,
                   options: [], animations: {
      card.alpha = 1
      card.transform = .identity
    })
  }
}
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

const buildInfoPlist = (version, build) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>Copy to Clipboard History</string>
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
      <key>NSExtensionActivationRule</key>
      <dict>
        <key>NSExtensionActivationSupportsText</key>
        <true/>
        <key>NSExtensionActivationSupportsWebURLWithMaxCount</key>
        <integer>1</integer>
        <key>NSExtensionActivationSupportsWebPageWithMaxCount</key>
        <integer>1</integer>
      </dict>
    </dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.share-services</string>
    <key>NSExtensionPrincipalClass</key>
    <string>$(PRODUCT_MODULE_NAME).CopyToClipboardViewController</string>
  </dict>
</dict>
</plist>
`;

module.exports = function withCopyToClipboardExtension(config) {
  // Add the App Group to the MAIN app's entitlements so the app can read the
  // shared container / pending queue that the extension and keyboard write to.
  config = withEntitlementsPlist(config, (mod) => {
    const groups = mod.modResults['com.apple.security.application-groups'] ?? [];
    if (!groups.includes(APP_GROUP_ID)) groups.push(APP_GROUP_ID);
    mod.modResults['com.apple.security.application-groups'] = groups;
    return mod;
  });

  config = withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const iosPath = mod.modRequest.platformProjectRoot;

    const nativeTargets = project.pbxNativeTargetSection();
    if (Object.values(nativeTargets).some(t => t && typeof t === 'object' && t.name === EXTENSION_NAME)) {
      return mod;
    }

    const extDir = path.join(iosPath, EXTENSION_NAME);
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(path.join(extDir, 'CopyToClipboardViewController.swift'), VIEW_CONTROLLER);
    fs.writeFileSync(
      path.join(extDir, 'Info.plist'),
      buildInfoPlist(config.version || '1.0.0', String(config.ios?.buildNumber ?? '1')),
    );
    fs.writeFileSync(path.join(extDir, `${EXTENSION_NAME}.entitlements`), ENTITLEMENTS);

    const target = project.addTarget(EXTENSION_NAME, 'app_extension', EXTENSION_NAME, EXTENSION_BUNDLE_ID);
    const targetUUID = target.uuid;
    const productRefUUID = target.pbxNativeTarget.productReference;

    project.addBuildPhase(
      [`${EXTENSION_NAME}/CopyToClipboardViewController.swift`],
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
