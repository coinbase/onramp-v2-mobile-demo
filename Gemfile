source 'https://rubygems.org'

# Pin CocoaPods to the version used for this project.
gem 'cocoapods', '~> 1.16'

# Ruby 3.4+/newer concurrent-ruby (>= 1.3.4) dropped the implicit `require
# 'logger'` that activesupport 6.1 relies on, breaking `pod install` with
# "uninitialized constant ActiveSupport::LoggerThreadSafeLevel::Logger".
# Pin below 1.3.4 (the std Expo workaround) so logger is required again.
gem 'concurrent-ruby', '< 1.3.4'
gem 'activesupport', '>= 6.1.7.5', '!= 7.1.0'
