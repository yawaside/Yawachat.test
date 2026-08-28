// YawaMetrics — compact mode implementation.
// SPDX-License-Identifier: GPL-2.0-or-later

#include "compact_widget.hpp"

#include <QGridLayout>
#include <QLabel>
#include <QMouseEvent>
#include <QStyle>
#include <QVBoxLayout>

#include "widgets.hpp"

namespace yawametrics {

namespace {

QColor tileStatusColor(const PlatformUiState& state)
{
    if (!state.enabled || !state.configured)
        return QColor(QStringLiteral("#565b6e"));
    if (state.loading)
        return QColor(QStringLiteral("#8b5cf6"));
    if (state.live)
        return QColor(QStringLiteral("#22c55e"));
    if (state.statusText == ymtr(QStringLiteral("Status.Error")))
        return QColor(QStringLiteral("#f43f5e"));
    return QColor(QStringLiteral("#565b6e"));
}

} // namespace

// ---------------------------------------------------------------------------
// CompactWidget::Tile — «площадка + число» (ФТ-4.2)
// ---------------------------------------------------------------------------

class CompactWidget::Tile : public QWidget {
public:
    explicit Tile(PlatformId id, CompactWidget* owner);

    void updateState(const PlatformUiState& state);
    void applyScale(qreal scale, bool hideNames);

protected:
    void mousePressEvent(QMouseEvent* event) override;

private:
    PlatformId m_id;
    CompactWidget* m_owner = nullptr;
    qreal m_scale = 1.0;

    QLabel* m_iconLabel = nullptr;
    QLabel* m_nameLabel = nullptr;
    FitLabel* m_numberLabel = nullptr;
    NeonDot* m_dot = nullptr;
};

CompactWidget::Tile::Tile(PlatformId id, CompactWidget* owner)
    : QWidget(owner)
    , m_id(id)
    , m_owner(owner)
{
    setObjectName(QStringLiteral("CompactTile"));
    setCursor(Qt::PointingHandCursor);

    m_iconLabel = new QLabel(this);
    m_iconLabel->setAlignment(Qt::AlignCenter);
    m_nameLabel = new QLabel(this);
    m_numberLabel = new FitLabel(this);
    m_numberLabel->setAlignment(Qt::AlignRight | Qt::AlignVCenter);
    m_dot = new NeonDot(this);

    auto* layout = new QHBoxLayout(this);
    layout->setContentsMargins(8, 4, 8, 4);
    layout->setSpacing(6);
    layout->addWidget(m_dot, 0, Qt::AlignVCenter);
    layout->addWidget(m_iconLabel, 0, Qt::AlignVCenter);
    layout->addWidget(m_nameLabel, 1, Qt::AlignLeft | Qt::AlignVCenter);
    layout->addWidget(m_numberLabel, 2, Qt::AlignRight | Qt::AlignVCenter);

    applyScale(1.0, false);
}

void CompactWidget::Tile::applyScale(qreal scale, bool hideNames)
{
    m_scale = scale;
    const int iconSize = qMax(10, qRound(20 * scale));
    m_iconLabel->setFixedSize(iconSize, iconSize);
    m_iconLabel->setPixmap(renderBrandIcon(m_id, iconSize));
    m_nameLabel->setFont(ymFont(qMax(7, qRound(11 * scale)), 700));
    m_numberLabel->setBaseFont(qMax(8, qRound(20 * scale)), 800);
    m_nameLabel->setVisible(!hideNames);
    setFixedHeight(qRound(CompactWidget::baseTileHeight() * scale));
}

void CompactWidget::Tile::updateState(const PlatformUiState& state)
{
    const QColor muted(QStringLiteral("#8b91a8"));
    const QColor text(QStringLiteral("#e7e7ef"));

    m_nameLabel->setText(platformShortCode(m_id));
    m_numberLabel->setFittedText(state.live ? formatViewers(state.viewers)
                                            : QStringLiteral("—"));
    m_numberLabel->setStyleSheet(
        QStringLiteral("color:%1;").arg(state.live ? text.name() : muted.name()));

    m_dot->setState(state.live, tileStatusColor(state));

    QString tooltip = platformDisplayName(m_id);
    tooltip += QStringLiteral(" · %1").arg(state.statusText);
    if (!state.detail.isEmpty())
        tooltip += QStringLiteral(" — %1").arg(state.detail);
    if (!state.title.isEmpty())
        tooltip += QStringLiteral("\n%1").arg(state.title);
    setToolTip(tooltip);
    update();
}

void CompactWidget::Tile::mousePressEvent(QMouseEvent* event)
{
    if (event->button() == Qt::LeftButton) {
        m_owner->requestPlatformSettings(m_id);
        return;
    }
    QWidget::mousePressEvent(event);
}

// ---------------------------------------------------------------------------
// CompactWidget::SummaryRow — суммарная строка
// ---------------------------------------------------------------------------

class CompactWidget::SummaryRow : public QFrame {
public:
    explicit SummaryRow(QWidget* parent);

    void setSummary(long long totalViewers, int liveCount, int activeCount);
    void applyScale(qreal scale);

private:
    QLabel* m_captionLabel = nullptr;
    FitLabel* m_numberLabel = nullptr;
    QLabel* m_liveLabel = nullptr;
};

CompactWidget::SummaryRow::SummaryRow(QWidget* parent)
    : QFrame(parent)
{
    setObjectName(QStringLiteral("CompactSummary"));

    m_captionLabel = new QLabel(this);
    m_numberLabel = new FitLabel(this);
    m_numberLabel->setAlignment(Qt::AlignRight | Qt::AlignVCenter);
    m_liveLabel = new QLabel(this);

    m_captionLabel->setStyleSheet(
        QStringLiteral("color:rgba(255,255,255,78%);letter-spacing:1px;"));
    m_liveLabel->setStyleSheet(QStringLiteral("color:rgba(255,255,255,60%);"));

    auto* layout = new QHBoxLayout(this);
    layout->setContentsMargins(10, 4, 10, 4);
    layout->setSpacing(8);
    layout->addWidget(m_captionLabel, 0, Qt::AlignLeft | Qt::AlignVCenter);
    layout->addWidget(m_liveLabel, 1, Qt::AlignLeft | Qt::AlignVCenter);
    layout->addWidget(m_numberLabel, 2, Qt::AlignRight | Qt::AlignVCenter);

    applyScale(1.0);
}

void CompactWidget::SummaryRow::applyScale(qreal scale)
{
    m_captionLabel->setFont(ymFont(qMax(7, qRound(10 * scale)), 800));
    m_captionLabel->setText(ymtr(QStringLiteral("Total.Caption")));
    m_liveLabel->setFont(ymFont(qMax(7, qRound(10 * scale)), 400));
    m_numberLabel->setBaseFont(qMax(8, qRound(20 * scale)), 900);
    m_numberLabel->setStyleSheet(QStringLiteral("color:#ffffff;"));
    setFixedHeight(qRound(CompactWidget::baseSummaryHeight() * scale));
}

void CompactWidget::SummaryRow::setSummary(long long totalViewers, int liveCount, int activeCount)
{
    m_numberLabel->setFittedText(formatViewers(totalViewers));
    m_liveLabel->setText(liveCount > 0
        ? ymtr(QStringLiteral("Total.LivePlatforms")).arg(liveCount).arg(activeCount)
        : ymtr(QStringLiteral("Total.NoLive")).arg(activeCount));
}

// ---------------------------------------------------------------------------
// CompactWidget
// ---------------------------------------------------------------------------

CompactWidget::CompactWidget(QWidget* parent)
    : QWidget(parent)
{
    auto* rootLayout = new QVBoxLayout(this);
    rootLayout->setContentsMargins(8, 8, 8, 8);
    rootLayout->setSpacing(6);

    m_summary = new SummaryRow(this);
    rootLayout->addWidget(m_summary);

    auto* tilesLayout = new QGridLayout;
    tilesLayout->setContentsMargins(0, 0, 0, 0);
    tilesLayout->setSpacing(6);
    for (int i = 0; i < kPlatformCount; ++i) {
        const PlatformId id = kPlatformOrder[i];
        m_tiles[i] = new Tile(id, this);
        tilesLayout->addWidget(m_tiles[i], i / 2, i % 2);
    }
    rootLayout->addLayout(tilesLayout);

    m_footer = new PollFooter(this);
    rootLayout->addWidget(m_footer);
    rootLayout->addStretch(1);

    applyConfig(AppConfig());
}

void CompactWidget::applyConfig(const AppConfig& config)
{
    m_config = config;
    m_scale = qBound(0.75, config.compactScale, 1.30);
    m_hideNames = config.compactHideNames;

    m_summary->applyScale(m_scale);
    for (int i = 0; i < kPlatformCount; ++i)
        m_tiles[i]->applyScale(m_scale, m_hideNames);

    auto* rootLayout = qobject_cast<QVBoxLayout*>(layout());
    if (rootLayout)
        rootLayout->setSpacing(qRound(6 * m_scale));
}

void CompactWidget::updateState(PlatformId id, const PlatformUiState& state)
{
    for (int i = 0; i < kPlatformCount; ++i) {
        if (kPlatformOrder[i] == id) {
            m_tiles[i]->updateState(state);
            return;
        }
    }
}

void CompactWidget::updateCountdown(int secondsLeft, int intervalSec)
{
    m_footer->setCountdown(secondsLeft, intervalSec);
}

void CompactWidget::setPolling(bool active)
{
    m_footer->setPollingActive(active);
}

void CompactWidget::setTotalSummary(long long totalViewers, int liveCount, int activeCount)
{
    m_summary->setSummary(totalViewers, liveCount, activeCount);
}

void CompactWidget::requestPlatformSettings(PlatformId id)
{
    emit openPlatformSettings(id);
}

} // namespace yawametrics
