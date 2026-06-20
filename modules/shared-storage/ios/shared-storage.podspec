require 'json'

Pod::Spec.new do |s|
  s.name           = 'shared-storage'
  s.version        = '1.0.0'
  s.summary        = 'App Group shared storage for Copy History'
  s.license        = 'MIT'
  s.author         = 'Marcus'
  s.homepage       = 'https://github.com/kiddkevin00/copyhistory'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.0'
  s.source         = { :path => '.' }
  s.source_files   = '*.swift'
  s.dependency 'ExpoModulesCore'
end
