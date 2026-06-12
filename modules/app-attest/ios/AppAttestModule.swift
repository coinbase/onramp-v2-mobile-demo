import DeviceCheck
import ExpoModulesCore
import Foundation
import os

/**
 * iOS App Attest bridge.
 *
 * Wraps `DCAppAttestService` (DeviceCheck framework). Maps the cross-platform
 * JS surface to Apple's native API:
 *   - generateKey()      -> DCAppAttestService.generateKey()
 *   - attestKey()        -> DCAppAttestService.attestKey(_:clientDataHash:)
 *   - generateAssertion()-> DCAppAttestService.generateAssertion(_:clientDataHash:)
 *
 * The private key is created in and never leaves the Secure Enclave; JS only
 * ever sees the opaque `keyId` and the base64 attestation/assertion blobs.
 *
 * Spec: #proj-onramp-app-2-app.
 */
public class AppAttestModule: Module {
  private let service = DCAppAttestService.shared
  // Surfaces in the device system log (Console.app / `log stream`) for any build
  // config, including Release where JS console logs are not forwarded to Metro.
  // Filter with: subsystem == "expo.modules.appattest" category == "AppAttest".
  private let logger = Logger(subsystem: "expo.modules.appattest", category: "AppAttest")

  public func definition() -> ModuleDefinition {
    Name("AppAttest")

    Constants([
      "provider": "apple-app-attest"
    ])

    AsyncFunction("isSupported") { () -> Bool in
      return self.service.isSupported
    }

    AsyncFunction("generateKey") { (promise: Promise) in
      guard self.service.isSupported else {
        self.logger.error("🛡️ APP_ATTEST generateKey: device reports App Attest UNSUPPORTED")
        promise.reject("E_UNSUPPORTED", "App Attest is not supported on this device")
        return
      }
      self.service.generateKey { keyId, error in
        if let error = error {
          self.logger.error("🛡️ APP_ATTEST generateKey FAILED: \(error.localizedDescription, privacy: .public)")
          promise.reject("E_GENERATE_KEY", error.localizedDescription)
          return
        }
        guard let keyId = keyId else {
          promise.reject("E_GENERATE_KEY", "generateKey returned no keyId")
          return
        }
        self.logger.notice("🛡️ APP_ATTEST generateKey OK (keyId prefix=\(keyId.prefix(8), privacy: .public)…)")
        promise.resolve(keyId)
      }
    }

    AsyncFunction("attestKey") { (keyId: String, clientDataHashB64: String, promise: Promise) in
      guard let clientDataHash = Data(base64Encoded: clientDataHashB64) else {
        promise.reject("E_BAD_HASH", "clientDataHashB64 is not valid base64")
        return
      }
      self.service.attestKey(keyId, clientDataHash: clientDataHash) { attestation, error in
        if let error = error {
          self.logger.error("🛡️ APP_ATTEST attestKey FAILED: \(error.localizedDescription, privacy: .public)")
          promise.reject("E_ATTEST", error.localizedDescription)
          return
        }
        guard let attestation = attestation else {
          promise.reject("E_ATTEST", "attestKey returned no attestation object")
          return
        }
        self.logger.notice("✅ APP_ATTEST attestKey GENERATED real attestation (keyId prefix=\(keyId.prefix(8), privacy: .public)…, bytes=\(attestation.count, privacy: .public))")
        promise.resolve(attestation.base64EncodedString())
      }
    }

    AsyncFunction("generateAssertion") { (keyId: String, clientDataHashB64: String, promise: Promise) in
      guard let clientDataHash = Data(base64Encoded: clientDataHashB64) else {
        promise.reject("E_BAD_HASH", "clientDataHashB64 is not valid base64")
        return
      }
      self.service.generateAssertion(keyId, clientDataHash: clientDataHash) { assertion, error in
        if let error = error {
          self.logger.error("🛡️ APP_ATTEST generateAssertion FAILED: \(error.localizedDescription, privacy: .public)")
          promise.reject("E_ASSERT", error.localizedDescription)
          return
        }
        guard let assertion = assertion else {
          promise.reject("E_ASSERT", "generateAssertion returned no assertion")
          return
        }
        self.logger.notice("✅ APP_ATTEST generateAssertion GENERATED real assertion (keyId prefix=\(keyId.prefix(8), privacy: .public)…, bytes=\(assertion.count, privacy: .public))")
        promise.resolve(assertion.base64EncodedString())
      }
    }
  }
}
