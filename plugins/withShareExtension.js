const { withXcodeProject, withEntitlementsPlist } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const APP_GROUP_ID = 'group.com.markutilitylabs.copyhistory';
const EXTENSION_NAME = 'ShareExtension';
const EXTENSION_BUNDLE_ID = 'com.markutilitylabs.copyhistory.ShareExtension';

const SHARE_VIEW_CONTROLLER = `import UIKit

class ShareViewController: UIViewController {
  private let suiteName = "${APP_GROUP_ID}"
  private let pendingKey = "pendingItems"

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
      .flatMap { $0.attachments ?? [] }
    tryProviders(providers, index: 0)
  }

  private func tryProviders(_ providers: [NSItemProvider], index: Int) {
    guard index < providers.count else { done(); return }
    let provider = providers[index]

    if provider.hasItemConformingToTypeIdentifier("public.plain-text") {
      provider.loadItem(forTypeIdentifier: "public.plain-text") { [weak self] data, _ in
        let text = data as? String ?? ""
        if !text.isEmpty {
          self?.save(text: text); self?.done()
        } else {
          self?.tryProviders(providers, index: index + 1)
        }
      }
    } else if provider.hasItemConformingToTypeIdentifier("public.url") {
      provider.loadItem(forTypeIdentifier: "public.url") { [weak self] data, _ in
        let text = (data as? URL)?.absoluteString ?? (data as? String) ?? ""
        if !text.isEmpty {
          self?.save(text: text); self?.done()
        } else {
          self?.tryProviders(providers, index: index + 1)
        }
      }
    } else {
      tryProviders(providers, index: index + 1)
    }
  }

  private func save(text: String) {
    guard let defaults = UserDefaults(suiteName: suiteName) else { return }
    var items = defaults.stringArray(forKey: pendingKey) ?? []
    items.append(text)
    if items.count > 200 { items = Array(items.suffix(200)) }
    defaults.set(items, forKey: pendingKey)
    defaults.synchronize()
  }

  private func done() {
    DispatchQueue.main.async {
      self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
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
    <string>$(PRODUCT_MODULE_NAME).ShareViewController</string>
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

module.exports = function withShareExtension(config) {
  // Add App Groups entitlement to the main app
  config = withEntitlementsPlist(config, (mod) => {
    const groups = mod.modResults['com.apple.security.application-groups'] ?? [];
    if (!groups.includes(APP_GROUP_ID)) groups.push(APP_GROUP_ID);
    mod.modResults['com.apple.security.application-groups'] = groups;
    return mod;
  });

  // Add Share Extension target to Xcode project
  config = withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const iosPath = mod.modRequest.platformProjectRoot;

    // Guard against double-adding
    const nativeTargets = project.pbxNativeTargetSection();
    if (Object.values(nativeTargets).some(t => t && typeof t === 'object' && t.name === EXTENSION_NAME)) {
      return mod;
    }

    // Write source files into ios/ShareExtension/
    const extDir = path.join(iosPath, EXTENSION_NAME);
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(path.join(extDir, 'ShareViewController.swift'), SHARE_VIEW_CONTROLLER);
    fs.writeFileSync(
      path.join(extDir, 'Info.plist'),
      buildInfoPlist(config.version || '1.0.0', String(config.ios?.buildNumber ?? '1')),
    );
    fs.writeFileSync(path.join(extDir, `${EXTENSION_NAME}.entitlements`), ENTITLEMENTS);

    // Add native target
    const target = project.addTarget(EXTENSION_NAME, 'app_extension', EXTENSION_NAME, EXTENSION_BUNDLE_ID);
    const targetUUID = target.uuid;
    const productRefUUID = target.pbxNativeTarget.productReference;

    // Add compile sources build phase
    project.addBuildPhase(
      [`${EXTENSION_NAME}/ShareViewController.swift`],
      'PBXSourcesBuildPhase',
      'Sources',
      targetUUID
    );

    // Set build settings on both Debug and Release configs for this target
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
        IPHONEOS_DEPLOYMENT_TARGET: '16.0',
        LD_RUNPATH_SEARCH_PATHS: '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
        PRODUCT_BUNDLE_IDENTIFIER: `"${EXTENSION_BUNDLE_ID}"`,
        PRODUCT_NAME: '"$(TARGET_NAME)"',
        SKIP_INSTALL: 'YES',
        SWIFT_VERSION: '5.0',
        TARGETED_DEVICE_FAMILY: '"1,2"',
      });
    });

    // addTarget already created a "Copy Files" phase on the main target that embeds the .appex.
    // Find it and add RemoveHeadersOnCopy so codesigning works correctly.
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
