// YawaMetrics — configuration model and platform reference.
// SPDX-License-Identifier: GPL-2.0-or-later

#include "config.hpp"

#include <QFile>
#include <QFileInfo>
#include <QHash>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonValue>
#include <QSaveFile>
#include <QStringList>
#include <QUrl>

#include <obs-module.h>

namespace yawametrics {

const PlatformId kPlatformOrder[kPlatformCount] = {
    PlatformId::Vk, PlatformId::Twitch, PlatformId::YouTube,
    PlatformId::TikTok, PlatformId::Kick, PlatformId::GoodGame,
};

// ---------------------------------------------------------------------------
// Векторные иконки площадок (SVG path-data, viewBox 24x24).
// Внутренние контуры «дыр» обходятся в направлении, противоположном внешнему,
// чтобы корректно заполняться правилом NonZero (WindingFill).
// ---------------------------------------------------------------------------

namespace {

struct PlatformInfo {
    const char* idName;      // "vk"
    const char* displayName; // "VK Video Live"
    const char* shortCode;   // "VK"
    const char* color;       // фирменный цвет
    const char* iconPath;    // SVG path-data
};

// clang-format off
constexpr PlatformInfo kPlatformInfos[kPlatformCount] = {
    {
        "vk", "VK Video Live", "VK", "#2787f5",
        // Монограмма VK
        "M2.5 7 L5.6 17 L8 17 L11.1 7 L8.9 7 L6.8 14 L4.7 7 Z "
        "M12.8 7 L15 7 L17.4 10.7 L19.8 7 L22 7 L18.7 11.9 L22 17 L19.8 17 "
        "L17.4 13.3 L15 17 L12.8 17 L16.1 11.9 Z",
    },
    {
        "twitch", "Twitch", "TW", "#9146ff",
        // Значок Twitch (глитч-облако с двумя слотами)
        "M4.5 2.8 L20.3 2.8 L20.3 13.8 L15.5 13.8 L12.2 17.1 L12.2 13.8 L4.5 13.8 Z "
        "M9.6 5.9 L9.6 10.7 L11.6 10.7 L11.6 5.9 Z "
        "M13.6 5.9 L13.6 10.7 L15.6 10.7 L15.6 5.9 Z",
    },
    {
        "youtube", "YouTube", "YT", "#ff334b",
        // Скруглённый прямоугольник с треугольником воспроизведения
        "M2.7 7.1 C2.7 5.6 3.9 4.4 5.4 4.4 L18.6 4.4 C20.1 4.4 21.3 5.6 21.3 7.1 "
        "L21.3 16.9 C21.3 18.4 20.1 19.6 18.6 19.6 L5.4 19.6 C3.9 19.6 2.7 18.4 2.7 16.9 Z "
        "M10 9.1 L15.7 12 L10 14.9 Z",
    },
    {
        "tiktok", "TikTok LIVE", "TT", "#25f4ee",
        // Нота TikTok (стебель с крюком + головка)
        "M13.1 3 L16.1 3 C16.4 5.5 18 7 20.4 7.3 L20.4 9.9 C18.7 9.9 17.1 9.4 15.9 8.5 "
        "L15.9 15.8 L13.1 15.8 Z "
        "M11.8 12.6 C14.2 12.6 16.2 14.6 16.2 17 C16.2 19.4 14.2 21.4 11.8 21.4 "
        "C9.4 21.4 7.4 19.4 7.4 17 C7.4 14.6 9.4 12.6 11.8 12.6 Z "
        "M11.8 15 C10.5 15 9.4 16 9.4 17.2 C9.4 18.5 10.5 19.5 11.8 19.5 "
        "C13.1 19.5 14.2 18.5 14.2 17.2 C14.2 16 13.1 15 11.8 15 Z",
    },
    {
        "kick", "Kick", "KC", "#53fc18",
        // Блочная буква K
        "M4 4.5 L9 4.5 L9 10 L13 4.5 L18.5 4.5 L13.6 11 L18.5 17.5 L13 17.5 "
        "L9 12.3 L9 17.5 L4 17.5 Z",
    },
    {
        "goodgame", "GoodGame", "GG", "#f59e0b",
        // Блочные буквы GG
        "M2 5.5 L11 5.5 L11 8.3 L4.8 8.3 L4.8 15.7 L11 15.7 L11 18.5 L2 18.5 Z "
        "M11 10.4 L6.4 10.4 L6.4 13.6 L11 13.6 Z "
        "M13 5.5 L22 5.5 L22 8.3 L15.8 8.3 L15.8 15.7 L22 15.7 L22 18.5 L13 18.5 Z "
        "M22 10.4 L17.4 10.4 L17.4 13.6 L22 13.6 Z",
    },
};
// clang-format on

int platformIndex(PlatformId id)
{
    switch (id) {
    case PlatformId::Vk: return 0;
    case PlatformId::Twitch: return 1;
    case PlatformId::YouTube: return 2;
    case PlatformId::TikTok: return 3;
    case PlatformId::Kick: return 4;
    case PlatformId::GoodGame: return 5;
    }
    return 0;
}

bool parseColor(const QString& text, QColor* out)
{
    if (text.isEmpty())
        return false;
    bool ok = false;
    const int value = text.toInt(&ok);
    if (ok && value >= 0 && value <= 0xFFFFFF) {
        if (out)
            *out = QColor::fromRgb(static_cast<QRgb>(value));
        return true;
    }
    const QColor color(text);
    if (color.isValid()) {
        if (out)
            *out = color;
        return true;
    }
    return false;
}

} // namespace

// ---------------------------------------------------------------------------
// AppConfig
// ---------------------------------------------------------------------------

AppConfig::AppConfig()
{
    // ФТ-5.10: VK/Twitch/YouTube — включены по умолчанию.
    platforms[0].enabled = true; // Vk
    platforms[1].enabled = true; // Twitch
    platforms[2].enabled = true; // YouTube
}

PlatformSettings& AppConfig::platform(PlatformId id)
{
    return platforms[platformIndex(id)];
}

const PlatformSettings& AppConfig::platform(PlatformId id) const
{
    return platforms[platformIndex(id)];
}

QJsonObject AppConfig::toJson() const
{
    QJsonObject root;
    root.insert(QStringLiteral("pollIntervalSec"), pollIntervalSec);
    root.insert(QStringLiteral("showStreamTitle"), showStreamTitle);
    root.insert(QStringLiteral("autoStartPolling"), autoStartPolling);
    root.insert(QStringLiteral("compactMode"), compactMode);
    root.insert(QStringLiteral("uiScalePercent"), uiScalePercent);
    root.insert(QStringLiteral("compactHideNames"), compactHideNames);
    root.insert(QStringLiteral("compactScale"), compactScale);

    QJsonObject platformsJson;
    for (int i = 0; i < kPlatformCount; ++i) {
        const PlatformId id = kPlatformOrder[i];
        const PlatformSettings& ps = platforms[i];
        QJsonObject item;
        item.insert(QStringLiteral("enabled"), ps.enabled);
        item.insert(QStringLiteral("channel"), ps.channel);
        item.insert(QStringLiteral("key"), ps.key);
        item.insert(QStringLiteral("secret"), ps.secret);
        platformsJson.insert(platformIdName(id), item);
    }
    root.insert(QStringLiteral("platforms"), platformsJson);
    return root;
}

AppConfig AppConfig::fromJson(const QJsonObject& root)
{
    AppConfig config;

    // ФТ-5.12: повреждённые значения никогда не роняют плагин —
    // любое несоответствие заменяется значением по умолчанию.
    const auto intIn = [&root](const QString& key, int fallback, int lo, int hi) {
        const QJsonValue v = root.value(key);
        if (!v.isDouble())
            return fallback;
        const int value = static_cast<int>(v.toDouble());
        if (value < lo || value > hi)
            return fallback;
        return value;
    };
    const auto boolIn = [&root](const QString& key, bool fallback) {
        const QJsonValue v = root.value(key);
        return v.isBool() ? v.toBool() : fallback;
    };

    config.pollIntervalSec = intIn(QStringLiteral("pollIntervalSec"), 15, 10, 120);
    config.showStreamTitle = boolIn(QStringLiteral("showStreamTitle"), true);
    config.autoStartPolling = boolIn(QStringLiteral("autoStartPolling"), true);
    config.compactMode = boolIn(QStringLiteral("compactMode"), false);
    config.uiScalePercent = intIn(QStringLiteral("uiScalePercent"), 100, 85, 140);
    config.compactHideNames = boolIn(QStringLiteral("compactHideNames"), false);

    const QJsonValue scaleValue = root.value(QStringLiteral("compactScale"));
    if (scaleValue.isDouble()) {
        const double scale = scaleValue.toDouble();
        if (scale >= 0.75 && scale <= 1.30)
            config.compactScale = scale;
    }

    const QJsonValue platformsValue = root.value(QStringLiteral("platforms"));
    if (platformsValue.isObject()) {
        const QJsonObject platformsJson = platformsValue.toObject();
        for (int i = 0; i < kPlatformCount; ++i) {
            const PlatformId id = kPlatformOrder[i];
            const QJsonValue item = platformsJson.value(platformIdName(id));
            if (!item.isObject())
                continue;
            const QJsonObject obj = item.toObject();
            PlatformSettings& ps = config.platforms[i];
            ps.enabled = obj.value(QStringLiteral("enabled")).toBool(ps.enabled);
            ps.channel = obj.value(QStringLiteral("channel")).toString(ps.channel);
            ps.key = obj.value(QStringLiteral("key")).toString(ps.key);
            ps.secret = obj.value(QStringLiteral("secret")).toString(ps.secret);
        }
    }
    return config;
}

AppConfig AppConfig::load(const QString& filePath)
{
    const QString path = filePath.isEmpty() ? defaultConfigPath() : filePath;
    QFile file(path);
    if (!file.exists() || !file.open(QIODevice::ReadOnly))
        return AppConfig(); // файла нет — значения по умолчанию

    const QByteArray raw = file.readAll();
    file.close();

    QJsonParseError error = {};
    const QJsonDocument doc = QJsonDocument::fromJson(raw, &error);
    if (error.error != QJsonParseError::NoError || !doc.isObject())
        return AppConfig(); // повреждён — значения по умолчанию (ФТ-5.12)

    return AppConfig::fromJson(doc.object());
}

void AppConfig::save(const QString& filePath) const
{
    const QString path = filePath.isEmpty() ? defaultConfigPath() : filePath;
    QSaveFile file(path);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Truncate))
        return;
    const QJsonDocument doc(toJson());
    file.write(doc.toJson(QJsonDocument::Indented));
    file.commit();
}

// ---------------------------------------------------------------------------
// Справочник площадок
// ---------------------------------------------------------------------------

QString platformIdName(PlatformId id)
{
    return QString::fromLatin1(kPlatformInfos[platformIndex(id)].idName);
}

QString platformDisplayName(PlatformId id)
{
    return ymtr(QStringLiteral("Platform.") + platformIdName(id));
}

QString platformShortCode(PlatformId id)
{
    return QString::fromLatin1(kPlatformInfos[platformIndex(id)].shortCode);
}

QColor platformColor(PlatformId id)
{
    QColor color;
    parseColor(QString::fromLatin1(kPlatformInfos[platformIndex(id)].color), &color);
    return color;
}

const char* platformIconPath(PlatformId id)
{
    return kPlatformInfos[platformIndex(id)].iconPath;
}

QString channelHint(PlatformId id, const QString& channel)
{
    const QString key = QStringLiteral("Hint.Url.") + platformIdName(id);
    const QString nick = channel.isEmpty() ? QStringLiteral("<%1>").arg(ymtr(QStringLiteral("Hint.Nick"))) : channel;
    QString text = ymtr(key);
    if (text == key) // нет перевода — показать исходный эндпоинт
        text = QString::fromLatin1(kPlatformInfos[platformIndex(id)].idName);
    return text.arg(nick);
}

QString platformPlaceholder(PlatformId id)
{
    const QString key = QStringLiteral("Placeholder.") + platformIdName(id);
    const QString text = ymtr(key);
    return text == key ? QString() : text;
}

namespace {

// Значащие префиксы сегментов пути, которые следует пропустить при разборе ссылки.
bool isSkippableSegment(const QString& segment)
{
    static const QStringList kSkip = {
        QStringLiteral("live"), QStringLiteral("channel"), QStringLiteral("c"),
        QStringLiteral("user"), QStringLiteral("video"), QStringLiteral("embed"),
        QStringLiteral("api"), QStringLiteral("v2"), QStringLiteral("channels"),
    };
    return kSkip.contains(segment, Qt::CaseInsensitive);
}

} // namespace

QString normalizeChannel(PlatformId id, const QString& raw)
{
    QString text = raw.trimmed();
    while (text.endsWith(QLatin1Char('/')))
        text.chop(1);
    if (text.isEmpty())
        return QString();

    // Полная ссылка → взять значащий сегмент пути.
    if (text.contains(QStringLiteral("://")) || text.startsWith(QStringLiteral("www."))) {
        const QUrl url = text.startsWith(QStringLiteral("www."))
            ? QUrl::fromUserInput(text)
            : QUrl(text);
        const QStringList segments = url.path().split(QLatin1Char('/'), Qt::SkipEmptyParts);
        QString candidate;
        for (const QString& segment : segments) {
            if (segment.startsWith(QLatin1Char('@')) || !isSkippableSegment(segment)) {
                candidate = segment;
                break;
            }
        }
        if (!candidate.isEmpty())
            text = candidate;
        else if (!segments.isEmpty())
            text = segments.last();
    }

    // Домен без протокола: twitch.tv/nick, youtube.com/@handle, goodgame.ru/channel/nick.
    static const char* kKnownHosts[] = {
        "live.vkvideo.ru", "vkvideo.ru", "vk.com", "twitch.tv", "www.twitch.tv",
        "youtube.com", "www.youtube.com", "m.youtube.com", "tiktok.com",
        "www.tiktok.com", "kick.com", "www.kick.com", "goodgame.ru",
        "www.goodgame.ru",
    };
    {
        const QStringList parts = text.split(QLatin1Char('/'), Qt::SkipEmptyParts);
        bool matchedHost = false;
        for (const QString& part : parts) {
            bool isHost = false;
            for (const char* host : kKnownHosts) {
                if (part.compare(QString::fromLatin1(host), Qt::CaseInsensitive) == 0) {
                    isHost = true;
                    break;
                }
            }
            if (isHost) {
                matchedHost = true;
                continue;
            }
            if (!matchedHost)
                continue; // сегменты до домена игнорируем
            if (isSkippableSegment(part) && !part.startsWith(QLatin1Char('@')))
                continue; // channel, c, live, api, v2, channels…
            text = part;
            break;
        }
        // Домен не найден — текст используется как есть (просто ник).
    }

    // Площадочные префиксы.
    if (id == PlatformId::YouTube) {
        // youtube.com/@handle, youtube.com/channel/UCxxx, youtube.com/c/name
        if (text.contains(QStringLiteral("/@")) || text.startsWith(QLatin1Char('@')))
            text = text.mid(text.indexOf(QLatin1Char('@')) + 1);
        if (text.startsWith(QStringLiteral("channel/"), Qt::CaseInsensitive))
            text = text.mid(8);
        if (text.startsWith(QLatin1Char('/')))
            text = text.mid(1);
        return text;
    }
    if (id == PlatformId::TikTok) {
        if (text.startsWith(QLatin1Char('@')))
            text = text.mid(1);
        if (text.startsWith(QStringLiteral("@")))
            text = text.mid(1);
    }
    if (text.startsWith(QLatin1Char('@')))
        text = text.mid(1);
    if (id == PlatformId::GoodGame && text.startsWith(QStringLiteral("channel/"), Qt::CaseInsensitive))
        text = text.mid(8);
    if (text.startsWith(QLatin1Char('/')))
        text = text.mid(1);
    return text;
}

// ---------------------------------------------------------------------------
// Локализация
// ---------------------------------------------------------------------------

namespace {
QHash<QString, QString> g_strings;
QString g_stringsLocale;
} // namespace

void loadStrings()
{
    g_strings.clear();

    QString locale = QString::fromUtf8(obs_get_locale());
    const QString baseDir = QStringLiteral("locale/");

    // Приоритет: текущая локаль OBS → ru-RU (основная) → en-US.
    QStringList candidates;
    if (!locale.isEmpty())
        candidates << locale;
    if (locale != QStringLiteral("ru-RU"))
        candidates << QStringLiteral("ru-RU");
    if (locale != QStringLiteral("en-US"))
        candidates << QStringLiteral("en-US");

    for (const QString& candidate : candidates) {
        char* filePtr = obs_module_file((baseDir + candidate + QStringLiteral(".ini")).toUtf8().constData());
        if (!filePtr)
            continue;
        const QString path = QString::fromUtf8(filePtr);
        bfree(filePtr);

        QFile file(path);
        if (!file.open(QIODevice::ReadOnly | QIODevice::Text))
            continue;

        g_stringsLocale = candidate;
        const QByteArray data = file.readAll();
        file.close();

        const QList<QByteArray> lines = data.split('\n');
        for (QByteArray rawLine : lines) {
            QString line = QString::fromUtf8(rawLine).trimmed();
            if (line.isEmpty() || line.startsWith(QLatin1Char('#')) || line.startsWith(QLatin1Char(';')))
                continue;
            const int eq = line.indexOf(QLatin1Char('='));
            if (eq <= 0)
                continue;
            const QString key = line.left(eq).trimmed();
            QString value = line.mid(eq + 1).trimmed();
            if (value.size() >= 2 && value.startsWith(QLatin1Char('"')) && value.endsWith(QLatin1Char('"'))) {
                value = value.mid(1, value.size() - 2);
                value.replace(QStringLiteral("\\n"), QStringLiteral("\n"));
            }
            if (!key.isEmpty())
                g_strings.insert(key, value);
        }
        break; // загружен первый доступный словарь
    }
}

QString ymtr(const QString& key)
{
    const auto it = g_strings.constFind(key);
    if (it != g_strings.constEnd())
        return it.value();
    return key;
}

// ---------------------------------------------------------------------------
// Служебные пути
// ---------------------------------------------------------------------------

QString defaultConfigPath()
{
    char* pathPtr = obs_module_config_path("config.json");
    if (!pathPtr)
        return QStringLiteral("yawametrics-config.json");
    const QString path = QString::fromUtf8(pathPtr);
    bfree(pathPtr);
    return path;
}

QString auxConfigPath(const QString& fileName)
{
    char* pathPtr = obs_module_config_path(fileName.toUtf8().constData());
    if (!pathPtr)
        return fileName;
    const QString path = QString::fromUtf8(pathPtr);
    bfree(pathPtr);
    return path;
}

QJsonObject loadAuxJson(const QString& fileName)
{
    QFile file(auxConfigPath(fileName));
    if (!file.open(QIODevice::ReadOnly))
        return QJsonObject();
    const QJsonDocument doc = QJsonDocument::fromJson(file.readAll());
    file.close();
    return doc.isObject() ? doc.object() : QJsonObject();
}

void saveAuxJson(const QString& fileName, const QJsonObject& object)
{
    QSaveFile file(auxConfigPath(fileName));
    if (!file.open(QIODevice::WriteOnly | QIODevice::Truncate))
        return;
    file.write(QJsonDocument(object).toJson(QJsonDocument::Indented));
    file.commit();
}

} // namespace yawametrics
