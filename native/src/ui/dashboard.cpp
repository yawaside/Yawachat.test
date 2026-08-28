// YawaMetrics — dashboard (full mode) implementation.
// SPDX-License-Identifier: GPL-2.0-or-later

#include "dashboard.hpp"

#include <QGraphicsOpacityEffect>
#include <QHBoxLayout>
#include <QLabel>
#include <QMouseEvent>
#include <QResizeEvent>
#include <QToolTip>
#include <QVBoxLayout>

#include "widgets.hpp"

namespace yawametrics {

namespace {

QColor badgeColorFor(const PlatformUiState& state)
{
    if (!state.enabled)
        return QColor(QStringLiteral("#8b91a8"));
    if (!state.configured)
        return QColor(QStringLiteral("#8b91a8"));
    if (state.loading)
        return QColor(QStringLiteral("#8b5cf6"));
    if (state.live)
        return QColor(QStringLiteral("#22c55e"));
    if (state.statusText == ymtr(QStringLiteral("Status.Error")))
        return QColor(QStringLiteral("#f43f5e"));
    return QColor(QStringLiteral("#8b91a8"));
}

bool badgePulsesFor(const PlatformUiState& state)
{
    return state.enabled && state.configured && state.live;
}

} // namespace

// ---------------------------------------------------------------------------
// DashboardWidget::QuickCard
// ---------------------------------------------------------------------------

class DashboardWidget::QuickCard : public QFrame {
public:
    explicit QuickCard(PlatformId id, DashboardWidget* owner);

    void updateState(const PlatformUiState& state);
    void applyScale(qreal scale, bool showTitle, const QString& channel);

protected:
    void mousePressEvent(QMouseEvent* event) override;

private:
    void refreshTooltip(const PlatformUiState& state);

    PlatformId m_id;
    DashboardWidget* m_owner = nullptr;
    qreal m_scale = 1.0;
    bool m_showTitle = true;
    QString m_channel;

    QLabel* m_iconLabel = nullptr;
    QLabel* m_nameLabel = nullptr;
    ElidedLabel* m_channelLabel = nullptr;
    NeonBadge* m_badge = nullptr;
    FitLabel* m_numberLabel = nullptr;
    QLabel* m_captionLabel = nullptr;
    ElidedLabel* m_titleLabel = nullptr;
    QGraphicsOpacityEffect* m_iconOpacity = nullptr;
};

DashboardWidget::QuickCard::QuickCard(PlatformId id, DashboardWidget* owner)
    : QFrame(owner)
    , m_id(id)
    , m_owner(owner)
{
    setObjectName(QStringLiteral("QuickCard"));
    setCursor(Qt::PointingHandCursor);

    m_iconLabel = new QLabel(this);
    m_iconLabel->setAlignment(Qt::AlignCenter);
    m_iconOpacity = new QGraphicsOpacityEffect(m_iconLabel);
    m_iconLabel->setGraphicsEffect(m_iconOpacity);

    m_nameLabel = new QLabel(this);
    m_channelLabel = new ElidedLabel(this);

    m_badge = new NeonBadge(this);

    m_numberLabel = new FitLabel(this);
    m_captionLabel = new QLabel(this);

    m_titleLabel = new ElidedLabel(this);

    auto* identityLayout = new QVBoxLayout;
    identityLayout->setContentsMargins(0, 0, 0, 0);
    identityLayout->setSpacing(0);
    identityLayout->addWidget(m_nameLabel, 0, Qt::AlignLeft | Qt::AlignVCenter);
    identityLayout->addWidget(m_channelLabel, 0, Qt::AlignLeft | Qt::AlignVCenter);

    auto* headLayout = new QHBoxLayout;
    headLayout->setContentsMargins(0, 0, 0, 0);
    headLayout->setSpacing(8);
    headLayout->addWidget(m_iconLabel, 0, Qt::AlignVCenter);
    headLayout->addLayout(identityLayout, 1);
    headLayout->addWidget(m_badge, 0, Qt::AlignVCenter);

    auto* numberLayout = new QHBoxLayout;
    numberLayout->setContentsMargins(0, 0, 0, 0);
    numberLayout->setSpacing(8);
    numberLayout->addWidget(m_numberLabel, 1, Qt::AlignVCenter);
    numberLayout->addWidget(m_captionLabel, 0, Qt::AlignVCenter);

    auto* rootLayout = new QVBoxLayout(this);
    rootLayout->setContentsMargins(10, 8, 10, 8);
    rootLayout->setSpacing(3);
    rootLayout->addLayout(headLayout);
    rootLayout->addLayout(numberLayout);
    rootLayout->addWidget(m_titleLabel, 0, Qt::AlignLeft | Qt::AlignVCenter);

    applyScale(1.0, true, QString());
}

void DashboardWidget::QuickCard::applyScale(qreal scale, bool showTitle, const QString& channel)
{
    m_scale = scale;
    m_showTitle = showTitle;
    m_channel = channel;

    const int iconSize = qMax(12, qRound(28 * scale));
    m_iconLabel->setFixedSize(iconSize, iconSize);
    m_iconLabel->setPixmap(renderBrandIcon(m_id, iconSize));

    m_nameLabel->setFont(ymFont(qMax(8, qRound(13 * scale)), 700));
    m_channelLabel->setFont(ymFont(qMax(7, qRound(11 * scale)), 400));
    m_captionLabel->setFont(ymFont(qMax(7, qRound(11 * scale)), 400));
    m_titleLabel->setFont(ymFont(qMax(7, qRound(12 * scale)), 400));

    m_numberLabel->setBaseFont(qMax(8, qRound(26 * scale)), 800);

    m_titleLabel->setVisible(m_showTitle);
    const int cardHeight = qRound(baseCardHeight(m_showTitle) * scale);
    setFixedHeight(cardHeight);

    m_channelLabel->setFullText(m_channel);
}

void DashboardWidget::QuickCard::updateState(const PlatformUiState& state)
{
    const QColor muted(QStringLiteral("#8b91a8"));
    const QColor text(QStringLiteral("#e7e7ef"));

    m_nameLabel->setText(platformDisplayName(m_id));
    m_channelLabel->setFullText(m_channel);
    m_channelLabel->setVisible(state.configured && !m_channel.isEmpty());

    m_badge->setBadge(state.statusText, badgeColorFor(state), badgePulsesFor(state));

    if (state.live) {
        m_numberLabel->setFittedText(formatViewers(state.viewers));
        m_numberLabel->setStyleSheet(QStringLiteral("color:%1;").arg(text.name()));
        m_captionLabel->setText(ymtr(QStringLiteral("Card.Viewers")));
        m_captionLabel->setStyleSheet(
            QStringLiteral("color:%1;").arg(text.name()));
    } else {
        m_numberLabel->setFittedText(QStringLiteral("—"));
        m_numberLabel->setStyleSheet(QStringLiteral("color:%1;").arg(muted.name()));
        m_captionLabel->setText(QString());
    }

    m_titleLabel->setFullText(m_showTitle ? state.title : QString());

    // Приглушить иконку выключенной/ненастроенной площадки.
    const qreal opacity = (state.enabled && state.configured) ? 1.0 : 0.35;
    m_iconOpacity->setOpacity(opacity);

    refreshTooltip(state);
    update();
}

void DashboardWidget::QuickCard::refreshTooltip(const PlatformUiState& state)
{
    QString tooltip = platformDisplayName(m_id);
    if (!m_channel.isEmpty())
        tooltip += QStringLiteral("\n") + ymtr(QStringLiteral("Card.Tooltip.Channel"))
                       .arg(m_channel);
    tooltip += QStringLiteral("\n") + ymtr(QStringLiteral("Card.Tooltip.Status"))
                   .arg(state.statusText);
    if (!state.detail.isEmpty())
        tooltip += QStringLiteral(" — %1").arg(state.detail);
    if (!state.title.isEmpty())
        tooltip += QStringLiteral("\n") + ymtr(QStringLiteral("Card.Tooltip.Title"))
                       .arg(state.title);
    if (!state.source.isEmpty())
        tooltip += QStringLiteral("\n") + ymtr(QStringLiteral("Card.Tooltip.Source"))
                       .arg(state.source);
    setToolTip(tooltip);
}

void DashboardWidget::QuickCard::mousePressEvent(QMouseEvent* event)
{
    if (event->button() == Qt::LeftButton) {
        m_owner->requestPlatformSettings(m_id);
        return;
    }
    QFrame::mousePressEvent(event);
}

// ---------------------------------------------------------------------------
// DashboardWidget::TotalCard
// ---------------------------------------------------------------------------

class DashboardWidget::TotalCard : public QFrame {
public:
    explicit TotalCard(QWidget* parent);

    void setSummary(long long totalViewers, int liveCount, int activeCount);
    void applyScale(qreal scale);

private:
    qreal m_scale = 1.0;
    QLabel* m_captionLabel = nullptr;
    FitLabel* m_numberLabel = nullptr;
    QLabel* m_subLabel = nullptr;
};

DashboardWidget::TotalCard::TotalCard(QWidget* parent)
    : QFrame(parent)
{
    setObjectName(QStringLiteral("TotalCard"));

    m_captionLabel = new QLabel(this);
    m_numberLabel = new FitLabel(this);
    m_subLabel = new QLabel(this);

    m_captionLabel->setStyleSheet(
        QStringLiteral("color:rgba(255,255,255,72%);letter-spacing:1px;"));
    m_subLabel->setStyleSheet(QStringLiteral("color:rgba(255,255,255,60%);"));

    auto* layout = new QVBoxLayout(this);
    layout->setContentsMargins(12, 8, 12, 8);
    layout->setSpacing(1);
    layout->addWidget(m_captionLabel, 0, Qt::AlignLeft | Qt::AlignVCenter);
    layout->addWidget(m_numberLabel, 1, Qt::AlignLeft | Qt::AlignVCenter);
    layout->addWidget(m_subLabel, 0, Qt::AlignLeft | Qt::AlignVCenter);

    applyScale(1.0);
}

void DashboardWidget::TotalCard::applyScale(qreal scale)
{
    m_scale = scale;
    m_captionLabel->setFont(ymFont(qMax(7, qRound(10 * scale)), 800));
    m_captionLabel->setText(ymtr(QStringLiteral("Total.Caption")));
    m_numberLabel->setBaseFont(qMax(8, qRound(22 * scale)), 900);
    m_numberLabel->setStyleSheet(QStringLiteral("color:#ffffff;"));
    m_subLabel->setFont(ymFont(qMax(7, qRound(11 * scale)), 400));
    setFixedHeight(qRound(baseTotalHeight() * scale));
}

void DashboardWidget::TotalCard::setSummary(long long totalViewers, int liveCount, int activeCount)
{
    m_numberLabel->setFittedText(formatViewers(totalViewers));

    QString subText;
    if (liveCount > 0)
        subText = ymtr(QStringLiteral("Total.LivePlatforms")).arg(liveCount).arg(activeCount);
    else if (activeCount > 0)
        subText = ymtr(QStringLiteral("Total.NoLive")).arg(activeCount);
    else
        subText = ymtr(QStringLiteral("Total.NotConfigured"));
    m_subLabel->setText(subText);
    setToolTip(ymtr(QStringLiteral("Total.Tooltip")).arg(totalViewers));
}

// ---------------------------------------------------------------------------
// DashboardWidget
// ---------------------------------------------------------------------------

DashboardWidget::DashboardWidget(QWidget* parent)
    : QWidget(parent)
{
    auto* layout = new QVBoxLayout(this);
    layout->setContentsMargins(10, 10, 10, 10);
    layout->setSpacing(8);

    m_totalCard = new TotalCard(this);
    layout->addWidget(m_totalCard);

    for (int i = 0; i < kPlatformCount; ++i) {
        const PlatformId id = kPlatformOrder[i];
        m_cards[i] = new QuickCard(id, this);
        layout->addWidget(m_cards[i]);
    }

    m_footer = new PollFooter(this);
    layout->addWidget(m_footer);
    layout->addStretch(1);

    applyConfig(AppConfig());
}

void DashboardWidget::applyConfig(const AppConfig& config)
{
    m_config = config;
    m_scale = qBound(0.85, config.uiScalePercent / 100.0, 1.40);
    m_showStreamTitle = config.showStreamTitle;

    m_totalCard->applyScale(m_scale);
    for (int i = 0; i < kPlatformCount; ++i) {
        m_cards[i]->applyScale(m_scale, m_showStreamTitle,
                               m_config.platforms[i].channel.trimmed());
    }

    auto* layout = qobject_cast<QVBoxLayout*>(this->layout());
    if (layout)
        layout->setSpacing(qRound(8 * m_scale));
}

void DashboardWidget::updateState(PlatformId id, const PlatformUiState& state)
{
    for (int i = 0; i < kPlatformCount; ++i) {
        if (kPlatformOrder[i] == id) {
            m_cards[i]->updateState(state);
            return;
        }
    }
}

void DashboardWidget::updateCountdown(int secondsLeft, int intervalSec)
{
    m_footer->setCountdown(secondsLeft, intervalSec);
}

void DashboardWidget::setPolling(bool active)
{
    m_footer->setPollingActive(active);
}

void DashboardWidget::setTotalSummary(long long totalViewers, int liveCount, int activeCount)
{
    m_totalCard->setSummary(totalViewers, liveCount, activeCount);
}

void DashboardWidget::requestPlatformSettings(PlatformId id)
{
    emit openPlatformSettings(id);
}

} // namespace yawametrics
