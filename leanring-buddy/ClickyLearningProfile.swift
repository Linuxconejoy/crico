//
//  ClickyLearningProfile.swift
//  leanring-buddy
//
//  Lightweight persisted learning profile used to personalize how Clicky
//  explains things without introducing heavyweight memory or account state.
//

import Foundation

enum ClickyPreferredLanguage: String, CaseIterable, Identifiable {
    case auto
    case english
    case spanish
    case portuguese
    case french

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .auto:
            return "Auto"
        case .english:
            return "English"
        case .spanish:
            return "Spanish"
        case .portuguese:
            return "Portuguese"
        case .french:
            return "French"
        }
    }

    var promptInstruction: String? {
        switch self {
        case .auto:
            return nil
        case .english:
            return "reply in english unless the user explicitly asks to switch languages."
        case .spanish:
            return "reply in spanish unless the user explicitly asks to switch languages."
        case .portuguese:
            return "reply in portuguese unless the user explicitly asks to switch languages."
        case .french:
            return "reply in french unless the user explicitly asks to switch languages."
        }
    }
}

enum ClickyTeachingStyle: String, CaseIterable, Identifiable {
    case balanced
    case stepByStep
    case concise
    case challengeMe

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .balanced:
            return "Balanced"
        case .stepByStep:
            return "Step by step"
        case .concise:
            return "Concise"
        case .challengeMe:
            return "Challenge me"
        }
    }

    var promptInstruction: String {
        switch self {
        case .balanced:
            return "teach naturally and adapt depth to the moment."
        case .stepByStep:
            return "teach in small sequential steps, and make transitions explicit."
        case .concise:
            return "start with the shortest clear explanation that still teaches the core idea."
        case .challengeMe:
            return "teach like a coach: push for deeper understanding, include tradeoffs, and do not over-simplify."
        }
    }
}

private enum ClickyGuidedHelpHintLanguage {
    case english
    case spanish
    case portuguese
    case french
}

struct ClickyLearningProfile: Equatable {
    static let maxLearningFocusLength = 120
    static let maxDurableContextLength = 220

    var preferredLanguage: ClickyPreferredLanguage = .auto
    var teachingStyle: ClickyTeachingStyle = .balanced
    var learningFocus: String = ""
    var durableContext: String = ""

    var normalizedLearningFocus: String {
        Self.normalizedText(learningFocus, maxLength: Self.maxLearningFocusLength)
    }

    var normalizedDurableContext: String {
        Self.normalizedText(durableContext, maxLength: Self.maxDurableContextLength)
    }

    var normalized: ClickyLearningProfile {
        ClickyLearningProfile(
            preferredLanguage: preferredLanguage,
            teachingStyle: teachingStyle,
            learningFocus: normalizedLearningFocus,
            durableContext: normalizedDurableContext
        )
    }

    var hasAnyCustomization: Bool {
        let profile = normalized
        return profile.preferredLanguage != .auto
            || profile.teachingStyle != .balanced
            || !profile.normalizedLearningFocus.isEmpty
            || !profile.normalizedDurableContext.isEmpty
    }

    var memorySummaryText: String {
        let profile = normalized
        var parts: [String] = []

        if profile.preferredLanguage != .auto {
            parts.append(profile.preferredLanguage.displayName.lowercased())
        }

        if profile.teachingStyle != .balanced {
            parts.append(profile.teachingStyle.displayName.lowercased())
        }

        if !profile.normalizedLearningFocus.isEmpty {
            parts.append("focus: \(profile.normalizedLearningFocus)")
        }

        if !profile.normalizedDurableContext.isEmpty {
            parts.append("context saved")
        }

        return parts.joined(separator: " - ")
    }

    var guidedHelpFollowUpHint: String {
        switch resolvedGuidedHelpHintLanguage {
        case .english:
            switch teachingStyle {
            case .balanced:
                return "say: \"walk me through this\""
            case .stepByStep:
                return "say: \"guide me step by step\""
            case .concise:
                return "say: \"next click?\""
            case .challengeMe:
                return "say: \"why this step?\""
            }
        case .spanish:
            switch teachingStyle {
            case .balanced:
                return "di: \"guiame por esto\""
            case .stepByStep:
                return "di: \"guiame paso a paso\""
            case .concise:
                return "di: \"que hago ahora?\""
            case .challengeMe:
                return "di: \"por que este paso?\""
            }
        case .portuguese:
            switch teachingStyle {
            case .balanced:
                return "diga: \"me guia nisso\""
            case .stepByStep:
                return "diga: \"me guia passo a passo\""
            case .concise:
                return "diga: \"qual e o proximo clique?\""
            case .challengeMe:
                return "diga: \"por que esse passo?\""
            }
        case .french:
            switch teachingStyle {
            case .balanced:
                return "dis: \"guide moi ici\""
            case .stepByStep:
                return "dis: \"guide moi etape par etape\""
            case .concise:
                return "dis: \"je clique ou?\""
            case .challengeMe:
                return "dis: \"pourquoi cette etape?\""
            }
        }
    }

    var promptBlock: String? {
        let profile = normalized
        guard profile.hasAnyCustomization else { return nil }

        var lines = ["saved user learning profile:"]

        if let languageInstruction = profile.preferredLanguage.promptInstruction {
            lines.append("- \(languageInstruction)")
        }

        lines.append("- teaching style: \(profile.teachingStyle.promptInstruction)")

        if !profile.normalizedLearningFocus.isEmpty {
            lines.append("- current learning focus: \(profile.normalizedLearningFocus). connect explanations to this when it is genuinely useful.")
        }

        if !profile.normalizedDurableContext.isEmpty {
            lines.append("- durable context about the user: \(profile.normalizedDurableContext). use this only when it helps and never repeat it back word for word.")
        }

        return lines.joined(separator: "\n")
    }

    static func normalizedText(_ text: String, maxLength: Int) -> String {
        let collapsed = text
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard collapsed.count > maxLength else {
            return collapsed
        }

        return String(collapsed.prefix(maxLength)).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var resolvedGuidedHelpHintLanguage: ClickyGuidedHelpHintLanguage {
        switch preferredLanguage {
        case .auto:
            return Self.guidedHelpHintLanguage(for: Locale.preferredLanguages.first)
        case .english:
            return .english
        case .spanish:
            return .spanish
        case .portuguese:
            return .portuguese
        case .french:
            return .french
        }
    }

    private static func guidedHelpHintLanguage(for localeIdentifier: String?) -> ClickyGuidedHelpHintLanguage {
        guard let localeIdentifier else {
            return .english
        }

        let normalizedIdentifier = localeIdentifier.lowercased()

        if normalizedIdentifier.hasPrefix("es") {
            return .spanish
        }

        if normalizedIdentifier.hasPrefix("pt") {
            return .portuguese
        }

        if normalizedIdentifier.hasPrefix("fr") {
            return .french
        }

        return .english
    }
}

enum ClickyLearningProfileStore {
    static let preferredLanguageKey = "clickyLearningProfile.preferredLanguage"
    static let teachingStyleKey = "clickyLearningProfile.teachingStyle"
    static let learningFocusKey = "clickyLearningProfile.learningFocus"
    static let durableContextKey = "clickyLearningProfile.durableContext"

    static func load(defaults: UserDefaults = .standard) -> ClickyLearningProfile {
        let preferredLanguage = ClickyPreferredLanguage(
            rawValue: defaults.string(forKey: preferredLanguageKey) ?? ""
        ) ?? .auto

        let teachingStyle = ClickyTeachingStyle(
            rawValue: defaults.string(forKey: teachingStyleKey) ?? ""
        ) ?? .balanced

        let profile = ClickyLearningProfile(
            preferredLanguage: preferredLanguage,
            teachingStyle: teachingStyle,
            learningFocus: defaults.string(forKey: learningFocusKey) ?? "",
            durableContext: defaults.string(forKey: durableContextKey) ?? ""
        )

        return profile.normalized
    }

    static func save(_ profile: ClickyLearningProfile, defaults: UserDefaults = .standard) {
        let normalizedProfile = profile.normalized
        defaults.set(normalizedProfile.preferredLanguage.rawValue, forKey: preferredLanguageKey)
        defaults.set(normalizedProfile.teachingStyle.rawValue, forKey: teachingStyleKey)
        defaults.set(normalizedProfile.normalizedLearningFocus, forKey: learningFocusKey)
        defaults.set(normalizedProfile.normalizedDurableContext, forKey: durableContextKey)
    }
}
