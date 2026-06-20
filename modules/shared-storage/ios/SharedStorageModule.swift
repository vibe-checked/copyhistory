import ExpoModulesCore

public class SharedStorageModule: Module {
  private let suiteName = "group.com.markutilitylabs.copyhistory"
  private let pendingKey = "pendingItems"

  public func definition() -> ModuleDefinition {
    Name("SharedStorage")

    AsyncFunction("getPendingItems") { () -> [String] in
      guard let defaults = UserDefaults(suiteName: self.suiteName) else { return [] }
      return defaults.stringArray(forKey: self.pendingKey) ?? []
    }

    AsyncFunction("clearPendingItems") { () in
      guard let defaults = UserDefaults(suiteName: self.suiteName) else { return }
      defaults.removeObject(forKey: self.pendingKey)
      defaults.synchronize()
    }
  }
}
