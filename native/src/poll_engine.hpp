// YawaMetrics — polling engine.
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Асинхронный опрос площадок через QNetworkAccessManager.
// UI-поток не блокируется ни на одном этапе (НФТ-1).

#pragma once

#include <QObject>
#include <QString>

#include "config.hpp"

class QNetworkAccessManager;
class QNetworkReply;
class QTimer;

namespace yawametrics {

// Состояние площадки, готовое к отрисовке. Объявлено на уровне
// пространства имён, а НЕ внутри PollEngine (ОР-9).
struct PlatformUiState {
    PlatformId id = PlatformId::Vk;
    bool configured = false; // канал заполнен
    bool enabled = false;    // опрос включён
    bool live = false;
    bool loading = false;
    long long viewers = 0;
    QString title;      // название стрима
    QString statusText; // LIVE / ОФЛАЙН / ОШИБКА / ВЫКЛ / НЕ НАСТРОЕНО / …
    QString detail;     // пояснение (например, текст ошибки) — в tooltip
    QString source;     // опрошенный адрес
};

class PollEngine : public QObject {
    Q_OBJECT

public:
    explicit PollEngine(AppConfig config, QObject* parent = nullptr);

    void applyConfig(const AppConfig& config);
    AppConfig config() const;

    void setPolling(bool enabled);
    bool isPolling() const;

    int secondsLeft() const;

    void pollNow();
    void testPlatform(PlatformId id);

    PlatformUiState state(PlatformId id) const;

signals:
    void snapshotReady(PlatformId id, PlatformUiState state);
    void tick(int secondsLeft, int intervalSec);
    void pollingChanged(bool enabled);
    void testFinished(PlatformId id, bool ok, QString message);

private:
    void onTickSecond();
    void startCycle();
    void finishCycle();
    void sendRequest(PlatformId id, bool testMode);
    void handleReply(QNetworkReply* reply, PlatformId id, bool testMode);
    void refreshBaseStates();

    AppConfig m_config;
    QNetworkAccessManager* m_qnam = nullptr;
    QTimer* m_tickTimer = nullptr;

    PlatformUiState m_states[kPlatformCount];
    int m_secondsLeft = 0;
    int m_pendingReplies = 0;
    bool m_cycleActive = false;
    bool m_polling = false;
};

} // namespace yawametrics
