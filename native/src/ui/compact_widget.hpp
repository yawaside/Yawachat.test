// YawaMetrics — compact mode.
// SPDX-License-Identifier: GPL-2.0-or-later
//
// CompactWidget: плитки «площадка + число», сумма и суммарная строка (ФТ-4.2).

#pragma once

#include <QWidget>

#include "../config.hpp"
#include "../poll_engine.hpp"

class QGridLayout;

namespace yawametrics {

class PollFooter;

class CompactWidget : public QWidget {
    Q_OBJECT

public:
    explicit CompactWidget(QWidget* parent = nullptr);

    void applyConfig(const AppConfig& config);
    void updateState(PlatformId id, const PlatformUiState& state);
    void updateCountdown(int secondsLeft, int intervalSec);
    void setPolling(bool active);
    void setTotalSummary(long long totalViewers, int liveCount, int activeCount);

    static int baseTileHeight() { return 56; }
    static int baseSummaryHeight() { return 64; }
    static int baseFooterHeight() { return 20; }

signals:
    void openPlatformSettings(PlatformId id);

public:
    void requestPlatformSettings(PlatformId id);

private:
    class Tile;

    qreal scale() const { return m_scale; }

    AppConfig m_config;
    qreal m_scale = 1.0;
    bool m_hideNames = false;

    class SummaryRow;
    SummaryRow* m_summary = nullptr;
    Tile* m_tiles[kPlatformCount] = {};
    PollFooter* m_footer = nullptr;
};

} // namespace yawametrics
