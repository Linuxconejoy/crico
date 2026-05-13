//
//  AppBundleConfiguration.swift
//  leanring-buddy
//
//  Shared helper for reading runtime configuration from the built app bundle.
//

import Foundation

enum AppBundleConfiguration {
    struct WorkerBackendConfiguration {
        let baseURL: URL
        let appKey: String?
        let chatURL: URL
        let ttsURL: URL
        let transcribeTokenURL: URL
    }

    struct WorkerBackendConfigurationStatus {
        let configuration: WorkerBackendConfiguration?
        let message: String

        var isConfigured: Bool {
            configuration != nil
        }
    }

    private static let workerBaseURLInfoKey = "ClickyWorkerBaseURL"
    private static let workerAppKeyInfoKey = "ClickyWorkerAppKey"

    static func stringValue(forKey key: String) -> String? {
        if let value = Bundle.main.object(forInfoDictionaryKey: key) as? String {
            let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmedValue.isEmpty {
                return trimmedValue
            }
        }

        guard let resourceInfoPath = Bundle.main.path(forResource: "Info", ofType: "plist"),
              let resourceInfo = NSDictionary(contentsOfFile: resourceInfoPath),
              let value = resourceInfo[key] as? String else {
            return nil
        }

        let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmedValue.isEmpty ? nil : trimmedValue
    }

    static var workerBackendConfigurationStatus: WorkerBackendConfigurationStatus {
        guard let workerBaseURLString = stringValue(forKey: workerBaseURLInfoKey) else {
            return WorkerBackendConfigurationStatus(
                configuration: nil,
                message: "Clicky backend is not configured. Add \(workerBaseURLInfoKey) to Info.plist."
            )
        }

        guard !looksLikePlaceholder(workerBaseURLString) else {
            return WorkerBackendConfigurationStatus(
                configuration: nil,
                message: "Clicky backend is not configured. Replace the placeholder \(workerBaseURLInfoKey) value with your real Worker URL."
            )
        }

        guard let workerBaseURL = normalizedHTTPURL(from: workerBaseURLString) else {
            return WorkerBackendConfigurationStatus(
                configuration: nil,
                message: "Clicky backend is invalid. \(workerBaseURLInfoKey) must be a full http or https URL."
            )
        }

        let configuration = WorkerBackendConfiguration(
            baseURL: workerBaseURL,
            appKey: stringValue(forKey: workerAppKeyInfoKey),
            chatURL: workerBaseURL.appendingPathComponent("chat"),
            ttsURL: workerBaseURL.appendingPathComponent("tts"),
            transcribeTokenURL: workerBaseURL.appendingPathComponent("transcribe-token")
        )

        return WorkerBackendConfigurationStatus(
            configuration: configuration,
            message: "Clicky backend is configured."
        )
    }

    static var workerBackendConfiguration: WorkerBackendConfiguration? {
        workerBackendConfigurationStatus.configuration
    }

    static var workerAppKey: String? {
        stringValue(forKey: workerAppKeyInfoKey)
    }

    private static func normalizedHTTPURL(from rawValue: String) -> URL? {
        guard var components = URLComponents(string: rawValue) else {
            return nil
        }

        let normalizedScheme = components.scheme?.lowercased()
        guard normalizedScheme == "http" || normalizedScheme == "https",
              components.host != nil else {
            return nil
        }

        if components.path == "/" {
            components.path = ""
        }

        return components.url
    }

    private static func looksLikePlaceholder(_ value: String) -> Bool {
        let normalizedValue = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return normalizedValue.contains("your-worker-name")
            || normalizedValue.contains("your-subdomain")
            || normalizedValue.contains("<#")
    }
}
