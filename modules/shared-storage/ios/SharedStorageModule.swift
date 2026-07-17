import ExpoModulesCore
import WidgetKit

public class SharedStorageModule: Module {
  private let suiteName = "group.com.markutilitylabs.copyhistory"
  private let pendingFileName = "pending_items.json"
  private let snippetsKey = "snippets"
  private let recentEntriesKey = "recentEntries"

  // Shared App Group container file that the share/action extensions append to.
  private func pendingFileURL() -> URL? {
    FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: suiteName)?
      .appendingPathComponent(pendingFileName)
  }

  public func definition() -> ModuleDefinition {
    Name("SharedStorage")

    // The pending-items queue is a plain FILE in the App Group container, not
    // UserDefaults. Extensions (share / action) write to it and this app drains
    // it. A long-lived app process caches a stale view of a UserDefaults suite
    // written by another process, so cross-process handoff via UserDefaults is
    // unreliable — a file read always reflects the extension's latest write.
    AsyncFunction("getPendingItems") { () -> [String] in
      guard let url = self.pendingFileURL(),
            let data = try? Data(contentsOf: url),
            let items = try? JSONDecoder().decode([String].self, from: data)
      else { return [] }
      return items
    }

    AsyncFunction("clearPendingItems") { () in
      guard let url = self.pendingFileURL() else { return }
      try? FileManager.default.removeItem(at: url)
    }

    // True once the keyboard extension has run with Full Access (it drops a
    // marker file in the shared container, which it can only do with Full
    // Access). Lets the app show a "set up the keyboard" tip until then.
    AsyncFunction("isKeyboardActive") { () -> Bool in
      guard let dir = FileManager.default
        .containerURL(forSecurityApplicationGroupIdentifier: self.suiteName) else { return false }
      return FileManager.default.fileExists(
        atPath: dir.appendingPathComponent("kbd_active.txt").path)
    }

    AsyncFunction("setSnippets") { (json: String) in
      guard let defaults = UserDefaults(suiteName: self.suiteName) else { return }
      defaults.set(json, forKey: self.snippetsKey)
      defaults.synchronize()
      if #available(iOS 14.0, *) {
        WidgetCenter.shared.reloadTimelines(ofKind: "SnippetsWidget")
      }
    }

    AsyncFunction("setRecentEntries") { (json: String) in
      guard let defaults = UserDefaults(suiteName: self.suiteName) else { return }
      defaults.set(json, forKey: self.recentEntriesKey)
      defaults.synchronize()
      if #available(iOS 14.0, *) {
        WidgetCenter.shared.reloadTimelines(ofKind: "HistoryWidget")
      }
    }
  }
}
