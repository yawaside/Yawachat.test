// YawaMetrics — polling engine implementation.
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Все запросы выполняются асинхронно через QNetworkAccessManager (ФТ-3.1),
// таймаут одного запроса — 10 с (ФТ-3.2), User-Agent браузера (ФТ-3.3),
// разбор ответов — регулярными выражениями в raw-строках (ФТ-3.4, ОР-1).

#include "poll_engine.hpp"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLocale>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QRegularExpression>
#include <QTimer>
#include <QUrl>

namespace yawametrics {

namespace {

constexpr int kRequestTimeoutMs = 10'000; // ФТ-3.2

const char* kBrowserUserAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Публичный Client-ID веб-плеера Twitch (ФТ-3.8: пользовательский ключ
// имеет приоритет, если он введён).
const char* kTwitchPublicClientId = "kimne78kx3ncx6brgo4mv6wki5h1ko";

// ---------------------------------------------------------------------------
// Разбор ответов
// ---------------------------------------------------------------------------

// Снимает экранирование JSON-строк: \" \\ \/ \n \t \r \uXXXX
void appendCodePoint(QString* out, uint code)
{
    if (code <= 0xFFFF) {
        out->append(QChar(static_cast<char16_t>(code)));
    } else {
        // Суррогатная пара
        const uint value = code - 0x10000;
        out->append(QChar(static_cast<char16_t>(0xD800 + (value >> 10))));
        out->append(QChar(static_cast<char16_t>(0xDC00 + (value & 0x3FF))));
    }
}

QString jsonUnescape(const QString& input)
{
    QString output;
    output.reserve(input.size());
    int i = 0;
    while (i < input.size()) {
        const QChar ch = input.at(i);
        if (ch != QLatin1Char('\\') || i + 1 >= input.size()) {
            output.append(ch);
            ++i;
            continue;
        }
        const QChar next = input.at(i + 1);
        i += 2;
        switch (next.unicode()) {
        case '"': output.append(QLatin1Char('"')); break;
        case '\\': output.append(QLatin1Char('\\')); break;
        case '/': output.append(QLatin1Char('/')); break;
        case 'n': output.append(QLatin1Char('\n')); break;
        case 't': output.append(QLatin1Char('\t')); break;
        case 'r': output.append(QLatin1Char('\r')); break;
        case 'b': output.append(QLatin1Char('\b')); break;
        case 'f': output.append(QLatin1Char('\f')); break;
        case 'u': {
            if (i + 4 <= input.size()) {
                bool ok = false;
                const uint code = input.mid(i, 4).toUInt(&ok, 16);
                if (ok) {
                    // Суррогатная пара: \uD83D\uDE00 → один символ.
                    if (code >= 0xD800 && code <= 0xDBFF && i + 11 <= input.size()
                        && input.at(i + 4) == QLatin1Char('\\')
                        && input.at(i + 5) == QLatin1Char('u')) {
                        bool lowOk = false;
                        const uint low = input.mid(i + 6, 4).toUInt(&lowOk, 16);
                        if (lowOk && low >= 0xDC00 && low <= 0xDFFF) {
                            const uint combined =
                                0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                            appendCodePoint(&output, combined);
                            i += 10;
                            break;
                        }
                    }
                    appendCodePoint(&output, code);
                    i += 4;
                    break;
                }
            }
            output.append(QLatin1Char('u'));
            break;
        }
        default:
            output.append(next);
            break;
        }
    }
    return output;
}

// Человекочитаемое число зрителей: «1,234 watching now» → 1234,
// «1.2K watching» → 1200, «1,2 тыс. смотрят» → 1200.
long long parseHumanNumber(const QString& text)
{
    QString digits;
    QString suffix;
    bool collecting = true;
    for (int i = 0; i < text.size(); ++i) {
        const QChar ch = text.at(i);
        if (collecting && (ch.isDigit()))
            digits.append(ch);
        else if (collecting && (ch == QLatin1Char(',') || ch == QLatin1Char('.')
                || ch == QChar(0x00a0) || ch == QChar(0x202f)
                || ch == QLatin1Char(' '))) {
            if (!digits.isEmpty())
                digits.append(ch);
        } else {
            collecting = false;
            const QString rest = text.mid(i).toLower();
            if (rest.startsWith(QLatin1Char('k')) || rest.startsWith(QStringLiteral("к")))
                suffix = QStringLiteral("k");
            else if (rest.startsWith(QLatin1Char('m')) || rest.startsWith(QStringLiteral("млн")))
                suffix = QStringLiteral("m");
            else if (rest.startsWith(QStringLiteral("тыс")))
                suffix = QStringLiteral("k");
            break;
        }
    }
    if (digits.isEmpty())
        return -1;

    if (suffix.isEmpty()) {
        // Разделители разрядов: «1 234», «1,234»
        QString cleaned;
        for (const QChar ch : std::as_const(digits)) {
            if (ch.isDigit())
                cleaned.append(ch);
        }
        return cleaned.toLongLong();
    }

    // Последний разделитель — десятичный: «1,2 тыс.» → 1.2
    QString cleaned;
    for (int i = 0; i < digits.size(); ++i) {
        const QChar ch = digits.at(i);
        if (ch.isDigit())
            cleaned.append(ch);
        else if (i + 1 < digits.size() && digits.at(i + 1).isDigit() && !cleaned.contains(QLatin1Char('.')))
            cleaned.append(QLatin1Char('.'));
    }
    const double value = cleaned.toDouble();
    const double factor = (suffix == QLatin1String("m")) ? 1'000'000.0 : 1'000.0;
    return static_cast<long long>(qRound(value * factor));
}

long long matchNumber(const QString& body, const QRegularExpression& expression, bool* matched)
{
    if (matched)
        *matched = false;
    const QRegularExpressionMatch m = expression.match(body);
    if (!m.hasMatch())
        return -1;
    const QString captured = m.captured(1);
    bool ok = false;
    const long long value = captured.toLongLong(&ok);
    if (!ok)
        return -1;
    if (matched)
        *matched = true;
    return value;
}

QString matchString(const QString& body, const QRegularExpression& expression)
{
    const QRegularExpressionMatch m = expression.match(body);
    if (!m.hasMatch())
        return QString();
    return jsonUnescape(m.captured(1)).simplified();
}

enum class ParseResult { Live, Offline, Error };

// Разбирает тело ответа площадки. При ошибке заполняет errorDetail.
ParseResult parseResponse(PlatformId id, const QString& body, long long* viewers, QString* title, QString* errorDetail)
{
    using R = QRegularExpression;

    if (id == PlatformId::Vk) {
        // Признак эфира: "status":"live" / "is_live":true
        static const R reLive(QStringLiteral(R"YM("status"\s*:\s*"[Ll]ive")YM"));
        static const R reLiveAlt(QStringLiteral(R"YM("is_live"\s*:\s*true)YM"));
        static const R reViewers(QStringLiteral(R"YM("(?:viewers|viewers_count|online_count)"\s*:\s*"?(\d+)"?)YM"));
        static const R reTitle(QStringLiteral(R"YM("title"\s*:\s*"((?:\\.|[^"\\])*)")YM"));
        const bool live = reLive.match(body).hasMatch() || reLiveAlt.match(body).hasMatch();
        if (!live)
            return ParseResult::Offline;
        bool hasViewers = false;
        const long long value = matchNumber(body, reViewers, &hasViewers);
        *viewers = hasViewers ? value : 0;
        *title = matchString(body, reTitle);
        return ParseResult::Live;
    }

    if (id == PlatformId::Twitch) {
        static const R reNoUser(QStringLiteral(R"YM("user"\s*:\s*null)YM"));
        static const R reLive(QStringLiteral(R"YM("stream"\s*:\s*\{)YM"));
        static const R reViewers(QStringLiteral(R"YM("viewersCount"\s*:\s*(\d+))YM"));
        static const R reTitle(QStringLiteral(R"YM("title"\s*:\s*"((?:\\.|[^"\\])*)")YM"));
        if (reNoUser.match(body).hasMatch()) {
            *errorDetail = ymtr(QStringLiteral("Test.Fail.NotFound"));
            return ParseResult::Error;
        }
        if (!reLive.match(body).hasMatch())
            return ParseResult::Offline;
        bool hasViewers = false;
        const long long value = matchNumber(body, reViewers, &hasViewers);
        *viewers = hasViewers ? value : 0;
        *title = matchString(body, reTitle);
        return ParseResult::Live;
    }

    if (id == PlatformId::YouTube) {
        // viewCount.simpleText | shortViewCountText (ФТ-2.3)
        static const R reViewCount(QStringLiteral(R"YM("viewCount"\s*:\s*\{[\s\S]{0,420}?"simpleText"\s*:\s*"([^"]+)")YM"));
        static const R reShortViewCount(QStringLiteral(R"YM("shortViewCountText"\s*:\s*\{[\s\S]{0,320}?"(?:simpleText|text)"\s*:\s*"([^"]+)")YM"));
        static const R reIsLive(QStringLiteral(R"YM("isLive"\s*:\s*true)YM"));
        static const R reTitle(QStringLiteral(R"YM("videoDetails"\s*:\s*\{[\s\S]{0,600}?"title"\s*:\s*"((?:\\.|[^"\\])*)")YM"));
        static const R reTitleFallback(QStringLiteral(R"YM("title"\s*:\s*"((?:\\.|[^"\\])*)")YM"));

        QString viewersText;
        const QRegularExpressionMatch vc = reViewCount.match(body);
        bool live = reIsLive.match(body).hasMatch();
        if (vc.hasMatch()) {
            viewersText = vc.captured(1);
            live = true;
        } else {
            const QRegularExpressionMatch svc = reShortViewCount.match(body);
            if (svc.hasMatch())
                viewersText = svc.captured(1);
        }
        *title = matchString(body, reTitle);
        if (title->isEmpty())
            *title = matchString(body, reTitleFallback);
        if (!live)
            return ParseResult::Offline;
        if (!viewersText.isEmpty())
            *viewers = qMax<long long>(0, parseHumanNumber(viewersText));
        return ParseResult::Live;
    }

    if (id == PlatformId::TikTok) {
        // Признак эфира — наличие roomId (ФТ-2.4)
        static const R reRoom(QStringLiteral(R"YM("roomId"\s*:\s*"(\d+)")YM"));
        static const R reViewers(QStringLiteral(R"YM("viewerCount"\s*:\s*(\d+))YM"));
        static const R reTitle(QStringLiteral(R"YM("title"\s*:\s*"((?:\\.|[^"\\])*)")YM"));
        if (!reRoom.match(body).hasMatch())
            return ParseResult::Offline;
        bool hasViewers = false;
        const long long value = matchNumber(body, reViewers, &hasViewers);
        *viewers = hasViewers ? value : 0;
        *title = matchString(body, reTitle);
        return ParseResult::Live;
    }

    if (id == PlatformId::Kick) {
        // livestream — объект или is_live (ФТ-2.5)
        static const R reLive(QStringLiteral(R"YM("livestream"\s*:\s*\{)YM"));
        static const R reLiveAlt(QStringLiteral(R"YM("is_live"\s*:\s*true)YM"));
        static const R reViewers(QStringLiteral(R"YM("viewer_count"\s*:\s*(\d+))YM"));
        static const R reTitle(QStringLiteral(R"YM("session_title"\s*:\s*"((?:\\.|[^"\\])*)")YM"));
        static const R reTitleFallback(QStringLiteral(R"YM("title"\s*:\s*"((?:\\.|[^"\\])*)")YM"));
        const bool live = reLive.match(body).hasMatch() || reLiveAlt.match(body).hasMatch();
        if (!live)
            return ParseResult::Offline;
        bool hasViewers = false;
        const long long value = matchNumber(body, reViewers, &hasViewers);
        *viewers = hasViewers ? value : 0;
        *title = matchString(body, reTitle);
        if (title->isEmpty())
            *title = matchString(body, reTitleFallback);
        return ParseResult::Live;
    }

    // GoodGame: "status":"live", зрители viewers | viewer_count | count (ФТ-2.6)
    {
        static const R reLive(QStringLiteral(R"YM("status"\s*:\s*"[Ll]ive")YM"));
        static const R reViewers(QStringLiteral(R"YM("viewers"\s*:\s*"?(\d+)"?)YM"));
        static const R reViewersAlt(QStringLiteral(R"YM("viewer_count"\s*:\s*"?(\d+)"?)YM"));
        static const R reViewersAlt2(QStringLiteral(R"YM("count"\s*:\s*"?(\d+)"?)YM"));
        static const R reTitle(QStringLiteral(R"YM("title"\s*:\s*"((?:\\.|[^"\\])*)")YM"));
        if (!reLive.match(body).hasMatch())
            return ParseResult::Offline;
        bool hasViewers = false;
        long long value = matchNumber(body, reViewers, &hasViewers);
        if (!hasViewers)
            value = matchNumber(body, reViewersAlt, &hasViewers);
        if (!hasViewers)
            value = matchNumber(body, reViewersAlt2, &hasViewers);
        *viewers = hasViewers ? value : 0;
        *title = matchString(body, reTitle);
        return ParseResult::Live;
    }
}

// ---------------------------------------------------------------------------
// Построение запросов
// ---------------------------------------------------------------------------

struct RequestSpec {
    QNetworkRequest request;
    QByteArray body; // непустое тело → POST
};

void applyCommonHeaders(QNetworkRequest* request, const char* acceptLanguage)
{
    request->setHeader(QNetworkRequest::UserAgentHeader, QVariant(QLatin1String(kBrowserUserAgent)));
    request->setRawHeader(QByteArrayLiteral("Accept-Language"), QByteArray(acceptLanguage));
    request->setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                          QVariant::fromValue<int>(QNetworkRequest::NoLessSafeRedirectPolicy));
    request->setTransferTimeout(kRequestTimeoutMs);
}

RequestSpec buildRequest(PlatformId id, const PlatformSettings& settings, QString* sourceUrl)
{
    RequestSpec spec;
    const QString channel = normalizeChannel(id, settings.channel);

    switch (id) {
    case PlatformId::Vk: {
        const QUrl url(QStringLiteral("https://live.vkvideo.ru/") + channel);
        spec.request.setUrl(url);
        applyCommonHeaders(&spec.request, "ru-RU,ru;q=0.9,en;q=0.8");
        spec.request.setRawHeader(QByteArrayLiteral("Accept"),
                                  QByteArrayLiteral("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"));
        break;
    }
    case PlatformId::Twitch: {
        spec.request.setUrl(QUrl(QStringLiteral("https://gql.twitch.tv/gql")));
        applyCommonHeaders(&spec.request, "en-US,en;q=0.9");
        spec.request.setHeader(QNetworkRequest::ContentTypeHeader, QVariant(QStringLiteral("application/json")));
        const QString clientId = settings.key.trimmed().isEmpty()
            ? QString::fromLatin1(kTwitchPublicClientId)
            : settings.key.trimmed();
        spec.request.setRawHeader(QByteArrayLiteral("Client-ID"), clientId.toUtf8());

        // Корректное экранирование гарантируется QJsonObject (ОР-1 не нарушается:
        // JSON собирается сериализатором, а не склейкой строк).
        const QString query = QStringLiteral(
            "query { user(login: \"%1\") { stream { viewersCount title } } }").arg(channel);
        const QJsonObject operation{std::make_pair(QStringLiteral("query"), query)};
        const QJsonDocument doc(QJsonArray{operation});
        spec.body = doc.toJson(QJsonDocument::Compact);
        break;
    }
    case PlatformId::YouTube: {
        const bool isChannelId = channel.startsWith(QStringLiteral("UC"), Qt::CaseInsensitive)
            && channel.size() >= 20;
        const QString path = isChannelId
            ? QStringLiteral("https://www.youtube.com/channel/") + channel + QStringLiteral("/live")
            : QStringLiteral("https://www.youtube.com/@") + channel + QStringLiteral("/live");
        spec.request.setUrl(QUrl(path));
        applyCommonHeaders(&spec.request, "en-US,en;q=0.9");
        spec.request.setRawHeader(QByteArrayLiteral("Accept"),
                                  QByteArrayLiteral("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"));
        break;
    }
    case PlatformId::TikTok: {
        spec.request.setUrl(QUrl(QStringLiteral("https://www.tiktok.com/@") + channel + QStringLiteral("/live")));
        applyCommonHeaders(&spec.request, "en-US,en;q=0.9");
        spec.request.setRawHeader(QByteArrayLiteral("Accept"),
                                  QByteArrayLiteral("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"));
        break;
    }
    case PlatformId::Kick: {
        spec.request.setUrl(QUrl(QStringLiteral("https://kick.com/api/v2/channels/") + channel));
        applyCommonHeaders(&spec.request, "en-US,en;q=0.9");
        spec.request.setRawHeader(QByteArrayLiteral("Accept"), QByteArrayLiteral("application/json"));
        break;
    }
    case PlatformId::GoodGame: {
        spec.request.setUrl(QUrl(QStringLiteral("https://goodgame.ru/channel/") + channel));
        applyCommonHeaders(&spec.request, "ru-RU,ru;q=0.9");
        spec.request.setRawHeader(QByteArrayLiteral("Accept"),
                                  QByteArrayLiteral("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"));
        break;
    }
    }

    if (sourceUrl)
        *sourceUrl = spec.request.url().toString(QUrl::PrettyDecoded | QUrl::RemoveQuery);
    return spec;
}

int platformIndex(PlatformId id)
{
    return static_cast<int>(id);
}

} // namespace

// ---------------------------------------------------------------------------
// PollEngine
// ---------------------------------------------------------------------------

PollEngine::PollEngine(AppConfig config, QObject* parent)
    : QObject(parent)
    , m_config(std::move(config))
{
    m_qnam = new QNetworkAccessManager(this);
    m_tickTimer = new QTimer(this);
    m_tickTimer->setInterval(1000);
    connect(m_tickTimer, &QTimer::timeout, this, &PollEngine::onTickSecond);

    m_secondsLeft = m_config.pollIntervalSec;
    refreshBaseStates();
}

void PollEngine::refreshBaseStates()
{
    for (int i = 0; i < kPlatformCount; ++i) {
        const PlatformId id = kPlatformOrder[i];
        const PlatformSettings& ps = m_config.platforms[i];
        PlatformUiState& st = m_states[i];
        st.id = id;
        st.enabled = ps.enabled;
        st.configured = !normalizeChannel(id, ps.channel).isEmpty();
        if (!st.enabled) {
            st.live = false;
            st.loading = false;
            st.statusText = ymtr(QStringLiteral("Status.Off"));
        } else if (!st.configured) {
            st.live = false;
            st.loading = false;
            st.statusText = ymtr(QStringLiteral("Status.NotConfigured"));
        }
    }
}

void PollEngine::applyConfig(const AppConfig& config)
{
    const bool intervalChanged = config.pollIntervalSec != m_config.pollIntervalSec;

    // Сброс устаревших данных, если канал изменился (сравнение до перезаписи).
    QString oldChannels[kPlatformCount];
    for (int i = 0; i < kPlatformCount; ++i)
        oldChannels[i] = normalizeChannel(kPlatformOrder[i], m_config.platforms[i].channel);

    m_config = config;

    for (int i = 0; i < kPlatformCount; ++i) {
        const PlatformId id = kPlatformOrder[i];
        PlatformUiState& st = m_states[i];
        const QString newChannel = normalizeChannel(id, m_config.platforms[i].channel);
        if (newChannel != oldChannels[i]) {
            st.live = false;
            st.loading = false;
            st.viewers = 0;
            st.title.clear();
        }
    }
    refreshBaseStates();

    if (intervalChanged)
        m_secondsLeft = qBound(0, m_secondsLeft, m_config.pollIntervalSec);

    // Обновить UI немедленно.
    for (int i = 0; i < kPlatformCount; ++i)
        emit snapshotReady(kPlatformOrder[i], m_states[i]);
}

AppConfig PollEngine::config() const
{
    return m_config;
}

void PollEngine::setPolling(bool enabled)
{
    if (m_polling == enabled)
        return;
    m_polling = enabled;
    if (enabled) {
        m_secondsLeft = m_config.pollIntervalSec;
        m_tickTimer->start();
        emit tick(m_secondsLeft, m_config.pollIntervalSec);
        pollNow(); // ФТ-6.1: первый опрос при старте
    } else {
        m_tickTimer->stop();
    }
    emit pollingChanged(enabled);
}

bool PollEngine::isPolling() const
{
    return m_polling;
}

int PollEngine::secondsLeft() const
{
    return m_secondsLeft;
}

void PollEngine::onTickSecond()
{
    if (!m_polling)
        return;
    if (m_cycleActive) {
        // ФТ-6.4: новый цикл не запускается, пока не завершён предыдущий.
        emit tick(m_secondsLeft, m_config.pollIntervalSec);
        return;
    }
    --m_secondsLeft;
    if (m_secondsLeft <= 0)
        startCycle();
    emit tick(m_secondsLeft, m_config.pollIntervalSec);
}

void PollEngine::pollNow()
{
    if (m_cycleActive)
        return;
    startCycle();
}

void PollEngine::startCycle()
{
    m_cycleActive = true;
    m_pendingReplies = 0;

    for (int i = 0; i < kPlatformCount; ++i) {
        const PlatformId id = kPlatformOrder[i];
        const PlatformSettings& ps = m_config.platforms[i];
        PlatformUiState& st = m_states[i];
        if (!ps.enabled || !st.configured)
            continue;

        st.loading = true;
        st.statusText = ymtr(QStringLiteral("Status.Loading"));
        emit snapshotReady(id, st);
        sendRequest(id, false);
        ++m_pendingReplies;
    }

    if (m_pendingReplies == 0)
        finishCycle();
}

void PollEngine::finishCycle()
{
    m_cycleActive = false;
    m_secondsLeft = m_config.pollIntervalSec;
    emit tick(m_secondsLeft, m_config.pollIntervalSec);
}

void PollEngine::sendRequest(PlatformId id, bool testMode)
{
    const RequestSpec spec = buildRequest(id, m_config.platforms[platformIndex(id)], nullptr);

    QNetworkReply* reply = spec.body.isEmpty()
        ? m_qnam->get(spec.request)
        : m_qnam->post(spec.request, spec.body);
    reply->setProperty("ymPlatform", static_cast<int>(id));
    reply->setProperty("ymTestMode", testMode);

    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        const PlatformId id = static_cast<PlatformId>(reply->property("ymPlatform").toInt());
        const bool testMode = reply->property("ymTestMode").toBool();
        handleReply(reply, id, testMode);
    });
}

void PollEngine::handleReply(QNetworkReply* reply, PlatformId id, bool testMode)
{
    reply->deleteLater();

    const int index = platformIndex(id);
    const QNetworkReply::NetworkError error = reply->error();
    const int httpStatus = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    const QString body = QString::fromUtf8(reply->readAll());
    const QString sourceUrl = reply->url().toString(QUrl::PrettyDecoded | QUrl::RemoveQuery);
    const QString errorText = reply->errorString();

    // Итог разбора: общая оценка для состояния площадки и сообщения теста.
    enum class Outcome { Live, Offline, NotFound, HttpError, Timeout, NetworkError, ParseError };
    Outcome outcome = Outcome::Offline;
    long long viewers = 0;
    QString title;
    QString parseError;
    QString detailText;
    int badHttpStatus = 0;

    if (error == QNetworkReply::OperationCanceledError) {
        outcome = Outcome::Timeout;
        detailText = ymtr(QStringLiteral("Error.Timeout"));
    } else if (error != QNetworkReply::NoError) {
        outcome = Outcome::NetworkError;
        detailText = errorText;
    } else if (httpStatus == 404) {
        outcome = Outcome::NotFound;
        detailText = ymtr(QStringLiteral("Test.Fail.NotFound"));
    } else if (httpStatus >= 400) {
        outcome = Outcome::HttpError;
        badHttpStatus = httpStatus;
        detailText = ymtr(QStringLiteral("Test.Fail.Http")).arg(httpStatus);
    } else {
        const ParseResult result = parseResponse(id, body, &viewers, &title, &parseError);
        if (result == ParseResult::Live)
            outcome = Outcome::Live;
        else if (result == ParseResult::Offline)
            outcome = Outcome::Offline;
        else {
            outcome = Outcome::ParseError;
            detailText = parseError;
        }
    }

    // --- Обновление состояния площадки (и для теста, и для обычного опроса).
    {
        PlatformUiState st = m_states[index];
        st.loading = false;
        st.source = sourceUrl;
        st.enabled = m_config.platforms[index].enabled;
        st.configured = !normalizeChannel(id, m_config.platforms[index].channel).isEmpty();

        if (!st.enabled) {
            st.live = false;
            st.viewers = 0;
            st.statusText = ymtr(QStringLiteral("Status.Off"));
            st.detail.clear();
            st.title.clear();
        } else {
            switch (outcome) {
            case Outcome::Live:
                st.live = true;
                st.viewers = viewers;
                st.title = title;
                st.statusText = ymtr(QStringLiteral("Status.Live"));
                st.detail.clear();
                break;
            case Outcome::Offline:
                st.live = false;
                st.viewers = 0;
                st.statusText = ymtr(QStringLiteral("Status.Offline"));
                st.detail.clear();
                break;
            default:
                st.live = false;
                st.viewers = 0;
                st.statusText = ymtr(QStringLiteral("Status.Error"));
                st.detail = detailText;
                break;
            }
        }
        m_states[index] = st;
        emit snapshotReady(id, st);
    }

    // --- Режим «Проверить подключение» (ФТ-3.7): тот же путь, что обычный опрос.
    if (testMode) {
        QString message;
        bool ok = false;
        switch (outcome) {
        case Outcome::Live: {
            ok = true;
            message = ymtr(QStringLiteral("Test.Ok.Live"))
                          .arg(QLocale::system().toString(static_cast<qulonglong>(viewers)));
            if (!title.isEmpty())
                message += QStringLiteral(" · «%1»").arg(title);
            break;
        }
        case Outcome::Offline:
            ok = true;
            message = ymtr(QStringLiteral("Test.Ok.Offline"));
            break;
        case Outcome::Timeout:
            message = ymtr(QStringLiteral("Test.Fail.Timeout"));
            break;
        case Outcome::NotFound:
            message = ymtr(QStringLiteral("Test.Fail.NotFound"));
            break;
        case Outcome::HttpError:
            message = ymtr(QStringLiteral("Test.Fail.Http")).arg(badHttpStatus);
            break;
        case Outcome::NetworkError:
            message = ymtr(QStringLiteral("Test.Fail.Network")).arg(errorText);
            break;
        case Outcome::ParseError:
            message = detailText;
            break;
        }
        emit testFinished(id, ok, message);
        return;
    }

    --m_pendingReplies;
    if (m_pendingReplies <= 0 && m_cycleActive)
        finishCycle();
}

PlatformUiState PollEngine::state(PlatformId id) const
{
    return m_states[platformIndex(id)];
}

void PollEngine::testPlatform(PlatformId id)
{
    const int index = platformIndex(id);
    const QString channel = normalizeChannel(id, m_config.platforms[index].channel);
    if (channel.isEmpty()) {
        emit testFinished(id, false, ymtr(QStringLiteral("Test.Fail.NoChannel")));
        return;
    }

    PlatformUiState& st = m_states[index];
    st.loading = true;
    st.statusText = ymtr(QStringLiteral("Status.Loading"));
    emit snapshotReady(id, st);

    sendRequest(id, true);
}

} // namespace yawametrics
