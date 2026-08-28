// YawaMetrics — dashboard (full mode).
// SPDX-License-Identifier: GPL-2.0-or-later
//
// DashboardWidget: сводка TotalCard + карточки QuickCard по каждой площадке,
// автоподгонка чисел (FitLabel) и реакция на resize (§4.2, ФТ-4.1).

#pragma once

#include <QWidget>

#include "../config.hpp"
#include "../poll_engine.hpp"

namespace yawametrics {

class PollFooter;

class DashboardWidget : public QWidget {
    Q_OBJECT

public:
    explicit DashboardWidget(QWidget* parent = nullptr);

    void applyConfig(const AppConfig& config);
    void updateState(PlatformId id, const PlatformUiState& state);
    void updateCountdown(int secondsLeft, int intervalSec);
    void setPolling(bool active);
    void setTotalSummary(long long totalViewers, int liveCount, int activeCount);

    // Размеры для расчёта габаритов дока (ФТ-4.3).
    static int baseCardHeight(bool withStreamTitle) { return withStreamTitle ? 124 : 102; }
    static int baseTotalHeight() { return 84; }
    static int baseFooterHeight() { return 24; }

    // Вызывается карточкой при клике — генерирует openPlatformSettings.
    void requestPlatformSettings(PlatformId id);

signals:
    void openPlatformSettings(PlatformId id);

private:
    qreal scale() const { return m_scale; }

    AppConfig m_config;
    qreal m_scale = 1.0;
    bool m_showStreamTitle = true;

    class TotalCard;
    class QuickCard;

    TotalCard* m_totalCard = nullptr;
    QuickCard* m_cards[kPlatformCount] = {};
    PollFooter* m_footer = nullptr;
};

} // namespace yawametrics
