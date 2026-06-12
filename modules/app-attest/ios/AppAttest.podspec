require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', '..', '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'AppAttest'
  s.version        = '1.0.0'
  s.summary        = 'iOS DCAppAttestService bridge for the app2app onramp flow'
  s.description    = 'Wraps Apple App Attest (DeviceCheck) for React Native / Expo.'
  s.author         = 'Coinbase'
  s.homepage       = 'https://docs.cdp.coinbase.com'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
