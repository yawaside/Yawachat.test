// YawaMetrics — dock panel root.
// SPDX-License-Identifier: GPL-2.0-or-later
//
// DockPanel: стек экранов (панель/настройки), скролл, переключение режимов,
// расчёт размеров и применение QSS (§4.2).

#pragma once

#include <QWidget>

#include "../config.hpp"
#include "../poll_engine.hpp"

class QDockWidget;
class QPushButton;
class QScrollArea;
class QShowEvent;
class QStackedWidget;
class QTimer;

namespace yawametrics {

class CompactWidget;
class DashboardWidget;
class PulseDot;
class SettingsWidget;

class DockPanel : public QWidget {
    Q_OBJECT

public:
    explicit DockPanel(QWidget* parent = nullptr);
    ~DockPanel() override;

    PollEngine* engine() const { return m_engine; }

    // НФТ-4: остановить таймеры и опрос при выгрузке модуля.
    void shutdown();

    QSize sizeHint() const override;
    QSize minimumSizeHint() const override;

protected:
    void showEvent(QShowEvent* event) override; // ФТ-6.1

private slots:
    // Контракты сигналов (§4.5)
    void onSnapshot(PlatformId id, PlatformUiState state);
    void onTick(int secondsLeft, int intervalSec);
    void onPollingChanged(bool active);
    void onConfigSaved(AppConfig config);
    void onOpenSettings();
    void onCloseSettings();
    void onToggleMode();
    void onOpenPlatformSettings(PlatformId id);

private:
    void buildUi();
    void loadStyleSheet();
    void applyMode(bool compact, bool animate);
    void recomputeDockSize();
    void recomputeTotal();
    void syncHeaderControls();

    AppConfig m_config;
    PollEngine* m_engine = nullptr;

    QWidget* m_header = nullptr;
    PulseDot* m_pulseDot = nullptr;
    QPushButton* m_compactButton = nullptr;
    QPushButton* m_settingsButton = nullptr;

    QStackedWidget* m_screens = nullptr; // 0 — панель, 1 — настройки
    QScrollArea* m_scroll = nullptr;
    QStackedWidget* m_views = nullptr; // 0 — полный, 1 — компактный
    DashboardWidget* m_dashboard = nullptr;
    CompactWidget* m_compact = nullptr;
    SettingsWidget* m_settings = nullptr;

    bool m_firstShow = true;
};

} // namespace yawametrics
