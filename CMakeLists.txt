cmake_minimum_required(VERSION 3.28)

# Версия изделия: единственный источник — CHANGELOG.md (см. §10 ТЗ).
# Здесь и в native/CMakeLists.txt значение сверяется check-version.mjs.
project(YawaMetrics VERSION 2.1.1 LANGUAGES NONE)

set(YAWAMETRICS_DEFAULT_VERSION "2.1.1")

if(NOT YAWAMETRICS_VERSION)
    set(YAWAMETRICS_VERSION "${YAWAMETRICS_DEFAULT_VERSION}")
endif()

message(STATUS "YawaMetrics version: ${YAWAMETRICS_VERSION}")

# Сборка нативного модуля — только Windows x64 (§5.1).
if(NOT WIN32)
    message(FATAL_ERROR "YawaMetrics targets Windows x64 only (MSVC). Use the windows-ci-x64 preset.")
endif()

add_subdirectory(native)
