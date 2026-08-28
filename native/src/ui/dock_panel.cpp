// YawaMetrics — dock panel root implementation.
// SPDX-License-Identifier: GPL-2.0-or-later

#include "dock_panel.hpp"

#include <QDockWidget>
#include <QFile>
#include <QFrame>
#include <QGraphicsOpacityEffect>
#include <QHBoxLayout>
#include <QLabel>
#include <QPainter>
#include <QPointer>
#include <QPropertyAnimation>
#include <QPushButton>
#include <QScrollArea>
#include <QShowEvent>
#include <QStackedWidget>
#include <QStyle>
#include <QTimer>
#include <QVBoxLayout>

#include <obs-module.h>

#include "compact_widget.hpp"
#include "dashboard.hpp"
#include "settings_widget.hpp"
#include "widgets.hpp"

namespace yawametrics {

namespace {

// Размеры дока (§6.4)
constexpr int kHeaderHeight = 44;
constexpr int kFullMinWidth = 320;
constexpr int kFullBaseWidth = 380;
constexpr int kFullMaxWidth = 480;
constexpr int kFullMinHeight = 430;
constexpr int kCompactMinWidth = 260;
constexpr int kCompactBaseWidth = 300;
constexpr int kCompactMaxWidth = 360;
constexpr int kCompactMinHeight = 210;
constexpr int kMaxHeight = 820; // ФТ-4.3

// Фолбэк-тема на случай отсутствия yawametrics.qss.
const char* kFallbackStyleSheet =
    "#YawaRoot{background:#06060b;}"
    "#HeaderBar{background:#121222;border-bottom:1px solid rgba(255,255,255,26);}"
    "QFrame#QuickCard,QFrame#CompactTile{background:#0d0d16;"
    "border:1px solid rgba(255,255,255,20);border-radius:10px;}"
    "QFrame#TotalCard,QFrame#CompactSummary{background:qlineargradient(x1:0,y1:0,x2:1,y2:1,"
    "stop:0 #8b5cf6,stop:1 #d946ef);border-radius:12px;}"
    "QFrame#SettingsPanel{background:#0d0d16;border:1px solid rgba(255,255,255,20);"
    "border-radius:10px;}"
    "QLabel{color:#e7e7ef;background:transparent;border:none;}"
    "QLineEdit,QComboBox{background:#121222;border:1px solid rgba(255,255,255,26);"
    "border-radius:6px;padding:5px 8px;color:#e7e7ef;}"
    "QPushButton{background:#121222;border:1px solid rgba(255,255,255,26);border-radius:6px;"
    "padding:6px 10px;color:#e7e7ef;}";

} // namespace

// ---------------------------------------------------------------------------
// DockPanel
// ---------------------------------------------------------------------------

DockPanel::DockPanel(QWidget* parent)
    : QWidget(parent)
{
    setObjectName(QStringLiteral("YawaRoot"));
    setAutoFillBackground(true);

    m_config = AppConfig::load();       // ФТ-5.12: повреждённый файл → умолчания
    m_engine = new PollEngine(m_config, this);

    buildUi();
    loadStyleSheet();

    // Путь к widget.html для вкладки «Виджет» (ФТ-7.11).
    char* widgetPtr = obs_module_file("widget.html");
    if (widgetPtr) {
        m_settings->setWidgetFilePath(QString::fromUtf8(widgetPtr));
        bfree(widgetPtr);
    }

    // --- Контракты сигналов (§4.5) ---
    connect(m_engine, &PollEngine::snapshotReady, this, &DockPanel::onSnapshot);
    connect(m_engine, &PollEngine::tick, this, &DockPanel::onTick);
    connect(m_engine, &PollEngine::pollingChanged, this, &DockPanel::onPollingChanged);
    connect(m_settings, &SettingsWidget::configSaved, this, &DockPanel::onConfigSaved);
    connect(m_settings, &SettingsWidget::closeRequested, this, &DockPanel::onCloseSettings);
    connect(m_dashboard, &DashboardWidget::openPlatformSettings, this,
            &DockPanel::onOpenPlatformSettings);
    connect(m_compact, &CompactWidget::openPlatformSettings, this,
            &DockPanel::onOpenPlatformSettings);

    // Начальное состояние карточек — до первого опроса.
    for (int i = 0; i < kPlatformCount; ++i) {
        const PlatformId id = kPlatformOrder[i];
        onSnapshot(id, m_engine->state(id));
    }
    recomputeTotal();
    applyMode(m_config.compactMode, false);
}

DockPanel::~DockPanel() = default;

void DockPanel::buildUi()
{
    auto* rootLayout = new QVBoxLayout(this);
    rootLayout->setContentsMargins(0, 0, 0, 0);
    rootLayout->setSpacing(0);

    // --- Шапка (ФТ-1.7) ---
    m_header = new QFrame(this);
    m_header->setObjectName(QStringLiteral("HeaderBar"));
    m_header->setFixedHeight(kHeaderHeight);

    auto* logoLabel = new QLabel(m_header);
    logoLabel->setPixmap(renderLogoPixmap(22));

    auto* titleLabel = new QLabel(QStringLiteral("YawaMetrics"), m_header);
    titleLabel->setObjectName(QStringLiteral("HeaderTitle"));

    auto* versionLabel = new QLabel(QStringLiteral(YAWAMETRICS_VERSION), m_header);
    versionLabel->setObjectName(QStringLiteral("HeaderVersion"));

    m_pulseDot = new PulseDot(m_header);
    m_pulseDot->setToolTip(ymtr(QStringLiteral("Header.Polling")));
    connect(m_pulseDot, &PulseDot::clicked, m_engine, &PollEngine::pollNow);

    m_compactButton = new QPushButton(m_header);
    m_compactButton->setObjectName(QStringLiteral("HeaderButton"));
    m_compactButton->setCheckable(true);
    m_compactButton->setChecked(m_config.compactMode);
    connect(m_compactButton, &QPushButton::clicked, this, &DockPanel::onToggleMode);

    m_settingsButton = new QPushButton(m_header);
    m_settingsButton->setObjectName(QStringLiteral("HeaderButton"));
    m_settingsButton->setText(ymtr(QStringLiteral("Header.Settings")));
    connect(m_settingsButton, &QPushButton::clicked, this, &DockPanel::onOpenSettings);

    auto* headerLayout = new QHBoxLayout(m_header);
    headerLayout->setContentsMargins(10, 6, 10, 6);
    headerLayout->setSpacing(8);
    headerLayout->addWidget(logoLabel, 0, Qt::AlignVCenter);
    headerLayout->addWidget(titleLabel, 0, Qt::AlignVCenter);
    headerLayout->addWidget(versionLabel, 0, Qt::AlignVCenter);
    headerLayout->addStretch(1);
    headerLayout->addWidget(m_pulseDot, 0, Qt::AlignVCenter);
    headerLayout->addWidget(m_compactButton, 0, Qt::AlignVCenter);
    headerLayout->addWidget(m_settingsButton, 0, Qt::AlignVCenter);
    rootLayout->addWidget(m_header);

    // --- Экраны: панель / настройки ---
    m_screens = new QStackedWidget(this);

    m_dashboard = new DashboardWidget(this);
    m_dashboard->applyConfig(m_config);
    m_compact = new CompactWidget(this);
    m_compact->applyConfig(m_config);

    m_views = new QStackedWidget(this);
    m_views->addWidget(m_dashboard);
    m_views->addWidget(m_compact);

    // ФТ-1.6: внутренняя область прокручивается.
    m_scroll = new QScrollArea(this);
    m_scroll->setObjectName(QStringLiteral("YawaScroll"));
    m_scroll->setWidgetResizable(true);
    m_scroll->setFrameShape(QFrame::NoFrame);
    m_scroll->setWidget(m_views);
    m_screens->addWidget(m_scroll);

    m_settings = new SettingsWidget(this);
    m_settings->setEngine(m_engine);
    m_settings->openWithConfig(m_config);
    m_screens->addWidget(m_settings);

    rootLayout->addWidget(m_screens, 1);
}

void DockPanel::loadStyleSheet()
{
    // Тема интерфейса — data/yawametrics.qss.
    QString styleSheet = QString::fromUtf8(kFallbackStyleSheet);
    char* qssPtr = obs_module_file("yawametrics.qss");
    if (qssPtr) {
        const QString path = QString::fromUtf8(qssPtr);
        bfree(qssPtr);
        QFile file(path);
        if (file.open(QIODevice::ReadOnly | QIODevice::Text)) {
            const QString qss = QString::fromUtf8(file.readAll());
            if (!qss.isEmpty())
                styleSheet = qss;
        }
    }
    setStyleSheet(styleSheet);
}

void DockPanel::showEvent(QShowEvent* event)
{
    QWidget::showEvent(event);
    if (!m_firstShow)
        return;
    m_firstShow = false;
    // ФТ-6.1: автостарт опроса при первом показе дока.
    if (m_config.autoStartPolling)
        m_engine->setPolling(true);
}

void DockPanel::shutdown()
{
    // НФТ-4: никаких таймеров и запросов после выгрузки.
    if (m_engine)
        m_engine->setPolling(false);
}

// ---------------------------------------------------------------------------
// Реакции движка
// ---------------------------------------------------------------------------

void DockPanel::onSnapshot(PlatformId id, PlatformUiState state)
{
    m_dashboard->updateState(id, state);
    m_compact->updateState(id, state);
    recomputeTotal();
}

void DockPanel::onTick(int secondsLeft, int intervalSec)
{
    // Контракт: tick → DashboardWidget::updateCountdown (+ компактный вид).
    m_dashboard->updateCountdown(secondsLeft, intervalSec);
    m_compact->updateCountdown(secondsLeft, intervalSec);
}

void DockPanel::onPollingChanged(bool active)
{
    m_dashboard->setPolling(active);
    m_compact->setPolling(active);
    m_pulseDot->setActive(active);
}

void DockPanel::recomputeTotal()
{
    // ФТ-2.10: сумма только по включённым площадкам в эфире.
    long long total = 0;
    int liveCount = 0;
    int activeCount = 0;
    for (int i = 0; i < kPlatformCount; ++i) {
        const PlatformUiState state = m_engine->state(kPlatformOrder[i]);
        if (state.enabled && state.configured) {
            ++activeCount;
            if (state.live) {
                ++liveCount;
                total += state.viewers;
            }
        }
    }
    m_dashboard->setTotalSummary(total, liveCount, activeCount);
    m_compact->setTotalSummary(total, liveCount, activeCount);
}

// ---------------------------------------------------------------------------
// Настройки и режимы
// ---------------------------------------------------------------------------

void DockPanel::onConfigSaved(AppConfig config)
{
    const bool modeChanged = config.compactMode != m_config.compactMode;
    m_config = config;
    m_config.save(); // ФТ-5.11: сохранение немедленно

    m_engine->applyConfig(m_config);
    m_dashboard->applyConfig(m_config);
    m_compact->applyConfig(m_config);

    if (modeChanged)
        applyMode(m_config.compactMode, true);
    else
        recomputeDockSize();
    syncHeaderControls();
}

void DockPanel::onOpenSettings()
{
    m_settings->openWithConfig(m_config);
    m_screens->setCurrentIndex(1);
}

void DockPanel::onCloseSettings()
{
    m_screens->setCurrentIndex(0);
    recomputeDockSize();
}

void DockPanel::onToggleMode()
{
    m_config.compactMode = m_compactButton->isChecked();
    m_config.save(); // ФТ-1.4: режим сохраняется между запусками
    m_engine->applyConfig(m_config);
    m_dashboard->applyConfig(m_config);
    m_compact->applyConfig(m_config);
    applyMode(m_config.compactMode, true);
}

void DockPanel::onOpenPlatformSettings(PlatformId id)
{
    // Контракт: DashboardWidget::openPlatformSettings → SettingsWidget::showPlatform.
    m_settings->openWithConfig(m_config);
    m_settings->showPlatform(id);
    m_screens->setCurrentIndex(1);
}

void DockPanel::syncHeaderControls()
{
    m_compactButton->setChecked(m_config.compactMode);
    m_compactButton->setText(ymtr(m_config.compactMode
                                      ? QStringLiteral("Header.ModeFull")
                                      : QStringLiteral("Header.ModeCompact")));
}

void DockPanel::applyMode(bool compact, bool animate)
{
    syncHeaderControls();
    m_views->setCurrentIndex(compact ? 1 : 0);
    recomputeDockSize();

    // ФТ-4.4: анимация смены режима, без пересоздания виджетов.
    if (animate) {
        auto* effect = new QGraphicsOpacityEffect(m_views);
        m_views->setGraphicsEffect(effect);
        effect->setOpacity(0.0);
        auto* animation = new QPropertyAnimation(effect, "opacity", m_views);
        animation->setDuration(160);
        animation->setStartValue(0.0);
        animation->setEndValue(1.0);
        connect(animation, &QPropertyAnimation::finished, m_views, [this]() {
            m_views->setGraphicsEffect(nullptr); // вернуть обычную отрисовку
        });
        animation->start(QAbstractAnimation::DeleteWhenStopped);
    }
}

// ---------------------------------------------------------------------------
// Размеры (ФТ-4.3, §6.4)
// ---------------------------------------------------------------------------

QSize DockPanel::sizeHint() const
{
    if (m_config.compactMode) {
        const qreal f = qBound(0.75, m_config.compactScale, 1.30);
        const int width = qRound(kCompactBaseWidth * f);
        // ФТ-4.3: шапка + сводка + Σ плиток + подвал, × масштаб.
        const int height = kHeaderHeight
            + 16 // поля компакта
            + qRound(CompactWidget::baseSummaryHeight() * f)
            + 3 * qRound(CompactWidget::baseTileHeight() * f)
            + 4 * qRound(6 * f) // интервалы
            + qRound(CompactWidget::baseFooterHeight() * f);
        return QSize(qBound(qRound(kCompactMinWidth * f), width, qRound(kCompactMaxWidth * f)),
                     qMin(kMaxHeight, height));
    }

    const qreal f = qBound(0.85, m_config.uiScalePercent / 100.0, 1.40);
    const int cardHeight = qRound(DashboardWidget::baseCardHeight(m_config.showStreamTitle) * f);
    const int height = kHeaderHeight
        + 20 // поля дашборда
        + qRound(DashboardWidget::baseTotalHeight() * f)
        + 7 * qRound(8 * f) // интервалы
        + kPlatformCount * cardHeight
        + qRound(DashboardWidget::baseFooterHeight() * f);
    const int width = qRound(kFullBaseWidth * f);
    return QSize(qBound(qRound(kFullMinWidth * f), width, qRound(kFullMaxWidth * f)),
                 qMin(kMaxHeight, height));
}

QSize DockPanel::minimumSizeHint() const
{
    if (m_config.compactMode) {
        const qreal f = qBound(0.75, m_config.compactScale, 1.30);
        return QSize(qRound(kCompactMinWidth * f), qRound(kCompactMinHeight * f));
    }
    const qreal f = qBound(0.85, m_config.uiScalePercent / 100.0, 1.40);
    return QSize(qRound(kFullMinWidth * f), qRound(kFullMinHeight * f));
}

void DockPanel::recomputeDockSize()
{
    updateGeometry();
    const QSize hint = sizeHint();
    QDockWidget* dock = qobject_cast<QDockWidget*>(parentWidget());
    if (dock && dock->isFloating()) {
        dock->resize(hint);
    } else if (dock) {
        resize(hint);
    }
}

} // namespace yawametrics
