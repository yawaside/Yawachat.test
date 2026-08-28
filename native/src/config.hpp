// YawaMetrics — native OBS Studio dock panel.
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Configuration model, JSON persistence and the platform reference
// (names, brand colors, vector icon path-data, hints, placeholders).

#pragma once

#include <QColor>
#include <QJsonObject>
#include <QString>

// Версия передаётся из CMake (-DYAWAMETRICS_VERSION="X.Y.Z").
// Фолбэк — только для локальной отладки вне CI.
#ifndef YAWAMETRICS_VERSION
#define YAWAMETRICS_VERSION "0.0.0-dev"
#endif

namespace yawametrics {

enum class PlatformId { Vk, Twitch, YouTube, TikTok, Kick, GoodGame };

constexpr int kPlatformCount = 6;
extern const PlatformId kPlatformOrder[kPlatformCount];

struct PlatformSettings {
    bool enabled = false;
    QString channel; // ник / handle / ссылка
    QString key;     // опциональный API-ключ
    QString secret;  // опциональный секрет
};

struct AppConfig {
    // ФТ-5.10: VK/Twitch/YouTube включены по умолчанию.
    AppConfig();

    int pollIntervalSec = 15;
    bool showStreamTitle = true;
    bool autoStartPolling = true;
    bool compactMode = false;
    int uiScalePercent = 100;
    bool compactHideNames = false;
    double compactScale = 1.0;
    PlatformSettings platforms[kPlatformCount];

    PlatformSettings& platform(PlatformId id);
    const PlatformSettings& platform(PlatformId id) const;

    QJsonObject toJson() const;
    static AppConfig fromJson(const QJsonObject& object);

    // Путь по умолчанию — каталог конфигурации OBS (obs_module_config_path).
    static AppConfig load(const QString& filePath = QString());
    void save(const QString& filePath = QString()) const;
};

// ---------------------------------------------------------------------------
// Справочник площадок
// ---------------------------------------------------------------------------

QString platformIdName(PlatformId id);       // "vk", "twitch", ...
QString platformDisplayName(PlatformId id);  // "VK Video Live", ...
QString platformShortCode(PlatformId id);    // "VK", "TW", "YT", "TT", "KC", "GG"
QColor platformColor(PlatformId id);
const char* platformIconPath(PlatformId id); // SVG path-data, viewBox 24x24

// Пояснение, какой адрес будет опрошен для текущего канала.
QString channelHint(PlatformId id, const QString& channel);
// Подсказка-плейсхолдер для поля ввода канала.
QString platformPlaceholder(PlatformId id);

// Приводит ссылку/ник к каноническому виду (без протокола и домена).
QString normalizeChannel(PlatformId id, const QString& raw);

// ---------------------------------------------------------------------------
// Локализация (data/locale/<locale>.ini, ru-RU — основной)
// ---------------------------------------------------------------------------

void loadStrings();                 // вызвать один раз в obs_module_load
QString ymtr(const QString& key);   // перевод или сам ключ

// ---------------------------------------------------------------------------
// Служебные пути
// ---------------------------------------------------------------------------

QString defaultConfigPath();        // config.json в каталоге конфигурации OBS
QString auxConfigPath(const QString& fileName); // доп. json в том же каталоге
QJsonObject loadAuxJson(const QString& fileName);
void saveAuxJson(const QString& fileName, const QJsonObject& object);

} // namespace yawametrics
