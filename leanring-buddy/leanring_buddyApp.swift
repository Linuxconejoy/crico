//
//  leanring_buddyApp.swift
//  leanring-buddy
//
//  Menu bar-only companion app. No dock icon, no main window - just an
//  always-available status item in the macOS menu bar. Clicking the icon
//  opens a floating panel with companion voice controls.
//

import ServiceManagement
import SwiftUI
import Sparkle

enum ClickyAppPreferences {
    static let launchAtLoginEnabledKey = "clickyLaunchAtLoginEnabled"

    static func registerDefaults() {
        UserDefaults.standard.register(defaults: [
            ClickyAnalytics.isEnabledDefaultsKey: false,
            launchAtLoginEnabledKey: false
        ])
    }

    static func setLaunchAtLoginEnabled(_ isEnabled: Bool) {
        UserDefaults.standard.set(isEnabled, forKey: launchAtLoginEnabledKey)
        syncLaunchAtLoginPreference()
    }

    static func syncLaunchAtLoginPreference() {
        let loginItemService = SMAppService.mainApp
        let shouldLaunchAtLogin = UserDefaults.standard.bool(forKey: launchAtLoginEnabledKey)

        do {
            if shouldLaunchAtLogin {
                if loginItemService.status != .enabled {
                    try loginItemService.register()
                    print("Clicky: Registered as login item after opt-in")
                }
            } else if loginItemService.status == .enabled {
                try loginItemService.unregister()
                print("Clicky: Removed login item because Launch at Login is off")
            }
        } catch {
            print("Clicky: Failed to sync login item preference: \(error)")
        }
    }
}

enum ClickyUpdateConfiguration {
    static let updatesEnabledKey = "ClickyUpdatesEnabled"
    private static let sparkleFeedURLKey = "SUFeedURL"
    private static let sparklePublicEDKeyKey = "SUPublicEDKey"
    private static let placeholderPublicKeyPrefix = "REPLACE_WITH_"
    private static let legacyMigrationMarkerKey = "clickyDidMigrateSparkleUserDefaults"
    private static let legacyUserDefaultsKeys = [
        sparkleFeedURLKey,
        "SUEnableAutomaticChecks",
        "SUAutomaticallyUpdate",
        "SUSendProfileInfo"
    ]

    struct Status {
        let isEnabled: Bool
        let sparkleFeedURL: String
        let shouldStartUpdater: Bool
        let logMessage: String
    }

    static func migrateLegacyUserDefaultOverridesIfNeeded() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: legacyMigrationMarkerKey) else {
            return
        }

        for key in legacyUserDefaultsKeys {
            guard defaults.object(forKey: key) != nil else {
                continue
            }

            let previousValue = defaults.object(forKey: key)
            defaults.removeObject(forKey: key)
            print("Clicky: Cleared legacy Sparkle user default override for \(key): \(String(describing: previousValue))")
        }

        defaults.set(true, forKey: legacyMigrationMarkerKey)
    }

    static func currentStatus(bundle: Bundle = .main) -> Status {
        let infoDictionary = bundle.infoDictionary ?? [:]
        let isEnabled = infoDictionary[updatesEnabledKey] as? Bool ?? false
        let sparkleFeedURL = (infoDictionary[sparkleFeedURLKey] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let sparklePublicEDKey = (infoDictionary[sparklePublicEDKeyKey] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        guard isEnabled else {
            return Status(
                isEnabled: false,
                sparkleFeedURL: sparkleFeedURL,
                shouldStartUpdater: false,
                logMessage: "Sparkle updates are disabled by explicit bundle configuration."
            )
        }

        guard isValidSparkleFeedURL(sparkleFeedURL) else {
            return Status(
                isEnabled: true,
                sparkleFeedURL: sparkleFeedURL,
                shouldStartUpdater: false,
                logMessage: "Sparkle updates are enabled but SUFeedURL is missing, non-HTTPS, or still using a placeholder."
            )
        }

        guard isValidSparklePublicEDKey(sparklePublicEDKey) else {
            return Status(
                isEnabled: true,
                sparkleFeedURL: sparkleFeedURL,
                shouldStartUpdater: false,
                logMessage: "Sparkle updates are enabled but SUPublicEDKey is missing or still using placeholder metadata."
            )
        }

        return Status(
            isEnabled: true,
            sparkleFeedURL: sparkleFeedURL,
            shouldStartUpdater: true,
            logMessage: "Sparkle updates are explicitly enabled and configuration passed validation."
        )
    }

    private static func isValidSparkleFeedURL(_ value: String) -> Bool {
        guard
            !value.isEmpty,
            !value.contains("example.com"),
            let url = URL(string: value),
            url.scheme?.lowercased() == "https",
            url.host != nil
        else {
            return false
        }

        return true
    }

    private static func isValidSparklePublicEDKey(_ value: String) -> Bool {
        guard
            !value.isEmpty,
            !value.hasPrefix(placeholderPublicKeyPrefix),
            value.count >= 43
        else {
            return false
        }

        let base64Characters = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=")
        return value.unicodeScalars.allSatisfy { base64Characters.contains($0) }
    }
}

@main
struct leanring_buddyApp: App {
    @NSApplicationDelegateAdaptor(CompanionAppDelegate.self) var appDelegate

    var body: some Scene {
        // The app lives entirely in the menu bar panel managed by the AppDelegate.
        // This empty Settings scene satisfies SwiftUI's requirement for at least
        // one scene but is never shown (LSUIElement=true removes the app menu).
        Settings {
            EmptyView()
        }
    }
}

/// Manages the companion lifecycle: creates the menu bar panel and starts
/// the companion voice pipeline on launch.
@MainActor
final class CompanionAppDelegate: NSObject, NSApplicationDelegate {
    private var menuBarPanelManager: MenuBarPanelManager?
    private let companionManager = CompanionManager()
    private var sparkleUpdaterController: SPUStandardUpdaterController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        print("Clicky: Starting...")
        print("Clicky: Version \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown")")

        ClickyAppPreferences.registerDefaults()
        UserDefaults.standard.register(defaults: ["NSInitialToolTipDelay": 0])
        ClickyUpdateConfiguration.migrateLegacyUserDefaultOverridesIfNeeded()

        ClickyAnalytics.configure()
        ClickyAnalytics.trackAppOpened()

        menuBarPanelManager = MenuBarPanelManager(companionManager: companionManager)
        companionManager.start()
        // Auto-open the panel if the user still needs to do something:
        // either they haven't onboarded yet, or permissions were revoked.
        if !companionManager.hasCompletedOnboarding || !companionManager.allPermissionsGranted {
            menuBarPanelManager?.showPanelOnLaunch()
        }
        ClickyAppPreferences.syncLaunchAtLoginPreference()
        startSparkleUpdaterIfConfigured()
    }

    func applicationWillTerminate(_ notification: Notification) {
        companionManager.stop()
    }

    private func startSparkleUpdaterIfConfigured() {
        let updateStatus = ClickyUpdateConfiguration.currentStatus()
        print("Clicky: \(updateStatus.logMessage)")

        guard updateStatus.shouldStartUpdater else {
            return
        }

        startSparkleUpdater(with: updateStatus)
    }

    private func startSparkleUpdater(with updateStatus: ClickyUpdateConfiguration.Status) {
        let updaterController = SPUStandardUpdaterController(
            startingUpdater: false,
            updaterDelegate: nil,
            userDriverDelegate: nil
        )
        self.sparkleUpdaterController = updaterController

        do {
            try updaterController.updater.start()
            print("Clicky: Sparkle updater started with feed \(updateStatus.sparkleFeedURL)")
        } catch {
            print("Clicky: Sparkle updater failed to start: \(error)")
        }
    }
}
