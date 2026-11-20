# Switch the app target's Release config to manual App Store signing.
# Only the OnrampV2Demo target changes; CocoaPods targets keep their settings,
# so resource bundles are not asked to use the app's provisioning profile.
#
# Usage (from the repo root, after prebuild and pod install):
#   bundle exec ruby tools/ios-publish/configure-ios-signing.rb TEAM_ID PROFILE_UUID
require "xcodeproj"

team_id, profile_uuid = ARGV
abort "usage: configure-ios-signing.rb TEAM_ID PROFILE_UUID" if team_id.to_s.empty? || profile_uuid.to_s.empty?

project_path = "ios/OnrampV2Demo.xcodeproj"
project = Xcodeproj::Project.open(project_path)
target = project.targets.find { |t| t.name == "OnrampV2Demo" }
abort "OnrampV2Demo target not found in #{project_path}" unless target

config = target.build_configurations.find { |c| c.name == "Release" }
abort "Release configuration not found on OnrampV2Demo" unless config

settings = config.build_settings
settings["CODE_SIGN_STYLE"] = "Manual"
settings["DEVELOPMENT_TEAM"] = team_id
settings["CODE_SIGN_IDENTITY"] = "Apple Distribution"
settings["CODE_SIGN_IDENTITY[sdk=iphoneos*]"] = "Apple Distribution"
settings["PROVISIONING_PROFILE_SPECIFIER"] = profile_uuid
settings.delete("PROVISIONING_PROFILE")

project.save
puts "OnrampV2Demo Release set to manual signing"
