cmake_minimum_required(VERSION 3.28)

# Версия по умолчанию — сверяется check-version.mjs (§10 ТЗ).
# CI передаёт точное значение через -DYAWAMETRICS_VERSION="X.Y.Z" (в кавычках, ОР-8).
set(YAWAMETRICS_DEFAULT_VERSION "2.1.1")
if(NOT YAWAMETRICS_VERSION)
    set(YAWAMETRICS_VERSION "${YAWAMETRICS_DEFAULT_VERSION}")
endif()

project(yawametrics VERSION "${YAWAMETRICS_VERSION}" LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Зависимости ставит scripts/Install-ObsDeps.ps1 в native/.deps (§8.1).
set(YAWAMETRICS_DEPS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/.deps")
if(EXISTS "${YAWAMETRICS_DEPS_DIR}/obs-include-dirs.cmake")
    include("${YAWAMETRICS_DEPS_DIR}/obs-include-dirs.cmake")
else()
    message(WARNING
        "OBS dependencies manifest not found: native/.deps/obs-include-dirs.cmake\n"
        "Run scripts/Install-ObsDeps.ps1 before configuring (see README.md).")
endif()

find_package(Qt6 REQUIRED COMPONENTS Core Widgets Network)

set(YAWAMETRICS_SOURCES
    src/plugin-main.cpp
    src/config.cpp
    src/poll_engine.cpp
    src/ui/widgets.cpp
    src/ui/dashboard.cpp
    src/ui/compact_widget.cpp
    src/ui/settings_widget.cpp
    src/ui/dock_panel.cpp
)

set(CMAKE_AUTOMOC ON)

# DLL кладётся в корень каталога сборки (native/.build/windows-ci-x64),
# где её ждёт .github/scripts/package-zip.ps1. Без этого module-цель из
# add_subdirectory(native) оказывается в <build>/native/yawametrics.dll.
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")

add_library(yawametrics MODULE ${YAWAMETRICS_SOURCES})

set_target_properties(yawametrics PROPERTIES
    OUTPUT_NAME "yawametrics"
    PREFIX ""
)

target_compile_definitions(yawametrics PRIVATE
    YAWAMETRICS_VERSION="${YAWAMETRICS_VERSION}"
    WIN32_LEAN_AND_MEAN
    NOMINMAX
    UNICODE
    _UNICODE
    QT_NO_CAST_FROM_ASCII
    QT_NO_CAST_TO_ASCII
)

# НФТ-7: сборка без предупреждений при /W3.
if(MSVC)
    target_compile_options(yawametrics PRIVATE /W3 /utf-8 /permissive-)
    if(YAWAMETRICS_WARN_AS_ERROR)
        target_compile_options(yawametrics PRIVATE /WX)
    endif()
endif()

target_include_directories(yawametrics PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${YAWAMETRICS_OBS_LIBOBS_INCLUDE}
    ${YAWAMETRICS_OBS_FRONTEND_INCLUDE}
    ${YAWAMETRICS_OBS_CONFIG_INCLUDE}
)

target_link_libraries(yawametrics PRIVATE
    Qt6::Core
    Qt6::Widgets
    Qt6::Network
    ${YAWAMETRICS_OBS_IMPORT_LIB_DIR}/obs.lib
    ${YAWAMETRICS_OBS_IMPORT_LIB_DIR}/obs-frontend-api.lib
)

# ---- Данные (data/obs-plugins/yawametrics) ----

set(YAWAMETRICS_DATA_DIR "${CMAKE_CURRENT_SOURCE_DIR}/data")

# Каталог сборки в дистрибутивной раскладке — удобно для локальной проверки.
set(YAWAMETRICS_BUILD_LAYOUT "${CMAKE_CURRENT_BINARY_DIR}/package")

add_custom_command(TARGET yawametrics POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory
        "${YAWAMETRICS_BUILD_LAYOUT}/obs-plugins/64bit"
        "${YAWAMETRICS_BUILD_LAYOUT}/data/obs-plugins/yawametrics/locale"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "$<TARGET_FILE:yawametrics>"
        "${YAWAMETRICS_BUILD_LAYOUT}/obs-plugins/64bit/yawametrics.dll"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${YAWAMETRICS_DATA_DIR}/yawametrics.qss"
        "${YAWAMETRICS_BUILD_LAYOUT}/data/obs-plugins/yawametrics/yawametrics.qss"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${YAWAMETRICS_DATA_DIR}/widget.html"
        "${YAWAMETRICS_BUILD_LAYOUT}/data/obs-plugins/yawametrics/widget.html"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${YAWAMETRICS_DATA_DIR}/locale/ru-RU.ini"
        "${YAWAMETRICS_BUILD_LAYOUT}/data/obs-plugins/yawametrics/locale/ru-RU.ini"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${YAWAMETRICS_DATA_DIR}/locale/en-US.ini"
        "${YAWAMETRICS_BUILD_LAYOUT}/data/obs-plugins/yawametrics/locale/en-US.ini"
    COMMENT "Assembling YawaMetrics runtime layout"
)

# MODULE-таргет: DLL-артефакт тянется через RUNTIME, но CMake требует
# LIBRARY DESTINATION для module-целей при установке (как и шаблон
# obs-plugintemplate). Указываем оба — поведение одинаково на всех платформах.
install(TARGETS yawametrics
    LIBRARY DESTINATION "obs-plugins/64bit"
    RUNTIME DESTINATION "obs-plugins/64bit"
)
install(FILES
    "${YAWAMETRICS_DATA_DIR}/yawametrics.qss"
    "${YAWAMETRICS_DATA_DIR}/widget.html"
    DESTINATION "data/obs-plugins/yawametrics"
)
install(FILES
    "${YAWAMETRICS_DATA_DIR}/locale/ru-RU.ini"
    "${YAWAMETRICS_DATA_DIR}/locale/en-US.ini"
    DESTINATION "data/obs-plugins/yawametrics/locale"
)
