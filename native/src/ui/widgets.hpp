// YawaMetrics — reusable UI widgets.
// SPDX-License-Identifier: GPL-2.0-or-later
//
// FitLabel, NeonBadge, NeonDot, PulseDot, PollProgressBar, SwitchBox,
// PollFooter, парсер SVG path-data и отрисовка фирменных иконок (§5.3, §6.3).

#pragma once

#include <QColor>
#include <QLabel>
#include <QPainterPath>
#include <QString>
#include <QTimer>
#include <QWidget>

#include "../config.hpp"

class QFontMetrics;
class QPaintEvent;
class QResizeEvent;

namespace yawametrics {

// ---------------------------------------------------------------------------
// SVG path / иконки
// ---------------------------------------------------------------------------

// Парсер команд M/m L/l H/h V/v C/c Q/q Z/z с поддержкой относительных
// координат; команда A/a (дуга) упрощается до хорды (§5.3).
QPainterPath pathFromSvgPathData(const QString& data);

// Рисует иконку площадки векторно по path-данным (ФТ-2.11).
QPixmap renderBrandIcon(PlatformId id, int size, const QColor& tint = QColor());

// Логотип YawaMetrics: градиентный скруглённый квадрат с «Y».
QPixmap renderLogoPixmap(int size);

// Обрезка текста по середине с многоточием (ФТ-4.6).
QString middleElidedText(const QString& text, const QFontMetrics& metrics, int width);

// Шрифт изделия: Inter с системным фолбэком (§6.2).
QFont ymFont(int px, int weight = 400);

// Форматирование числа по локали с разделителями разрядов (ФТ-4.9).
QString formatViewers(long long viewers);

// ---------------------------------------------------------------------------
// FitLabel — автоподгонка кегля (ФТ-4.5)
// ---------------------------------------------------------------------------

class FitLabel : public QLabel {
    Q_OBJECT

public:
    explicit FitLabel(QWidget* parent = nullptr);

    void setBaseFont(int px, int weight = 800);
    void setFittedText(const QString& text);

protected:
    void resizeEvent(QResizeEvent* event) override;

private:
    void refit();

    QString m_text;
    int m_basePx = 26;
    int m_baseWeight = 800;
};

// ---------------------------------------------------------------------------
// NeonBadge — бейдж статуса (ФТ-4.7, ФТ-4.8)
// ---------------------------------------------------------------------------

class NeonBadge : public QWidget {
    Q_OBJECT

public:
    explicit NeonBadge(QWidget* parent = nullptr);

    void setBadge(const QString& text, const QColor& color, bool pulsing);
    QSize sizeHint() const override;

protected:
    void paintEvent(QPaintEvent* event) override;

private:
    void advancePhase();

    QString m_text;
    QColor m_color;
    bool m_pulsing = false;
    qreal m_phase = 0.0;
    QTimer m_timer;
};

// ---------------------------------------------------------------------------
// NeonDot — точка 12x12 с пульсацией в live (ФТ-4.7)
// ---------------------------------------------------------------------------

class NeonDot : public QWidget {
    Q_OBJECT

public:
    explicit NeonDot(QWidget* parent = nullptr);

    void setState(bool live, const QColor& color);
    QSize sizeHint() const override;

protected:
    void paintEvent(QPaintEvent* event) override;

private:
    void advancePhase();

    QColor m_color;
    bool m_live = false;
    qreal m_phase = 0.0;
    QTimer m_timer;
};

// ---------------------------------------------------------------------------
// PulseDot — индикатор активности опроса (§6.3: радиус 3.0 ± 1.2, ~1400 мс)
// ---------------------------------------------------------------------------

class PulseDot : public QWidget {
    Q_OBJECT

public:
    explicit PulseDot(QWidget* parent = nullptr);

    void setActive(bool active);
    QSize sizeHint() const override;

signals:
    void clicked();

protected:
    void paintEvent(QPaintEvent* event) override;
    void mousePressEvent(class QMouseEvent* event) override;

private:
    void advancePhase();

    bool m_active = false;
    qreal m_phase = 0.0;
    QTimer m_timer;
};

// ---------------------------------------------------------------------------
// PollProgressBar — прогресс до следующего цикла (§6.3, ФТ-6.5)
// ---------------------------------------------------------------------------

class PollProgressBar : public QWidget {
    Q_OBJECT

public:
    explicit PollProgressBar(QWidget* parent = nullptr);

    void setFraction(qreal fraction); // 0..1 — доля до следующего цикла
    QSize sizeHint() const override;

protected:
    void paintEvent(QPaintEvent* event) override;

private:
    qreal m_fraction = 0.0;
};

// ---------------------------------------------------------------------------
// SwitchBox — переключатель (§6.3: трек 46x24, ручка 18)
// ---------------------------------------------------------------------------

class SwitchBox : public QWidget {
    Q_OBJECT

public:
    explicit SwitchBox(QWidget* parent = nullptr);

    bool isChecked() const;
    void setChecked(bool checked);

    QSize sizeHint() const override;

signals:
    void toggled(bool checked);

protected:
    void paintEvent(QPaintEvent* event) override;
    void mousePressEvent(class QMouseEvent* event) override;
    void enterEvent(class QEnterEvent* event) override;
    void leaveEvent(QEvent* event) override;
    void keyPressEvent(class QKeyEvent* event) override;

private:
    bool m_checked = false;
    bool m_hovered = false;
};

// ---------------------------------------------------------------------------
// ElidedLabel — обрезка по середине с полным текстом в tooltip (ФТ-4.6)
// ---------------------------------------------------------------------------

class ElidedLabel : public QLabel {
    Q_OBJECT

public:
    explicit ElidedLabel(QWidget* parent = nullptr);

    void setFullText(const QString& text);
    QString fullText() const;

protected:
    void resizeEvent(QResizeEvent* event) override;

private:
    void refresh();

    QString m_fullText;
};

// ---------------------------------------------------------------------------
// PollFooter — подвал: прогресс-бар, интервал, остаток секунд, версия (ФТ-1.8)
// ---------------------------------------------------------------------------

class PollFooter : public QWidget {
    Q_OBJECT

public:
    explicit PollFooter(QWidget* parent = nullptr);

    void setCountdown(int secondsLeft, int intervalSec);
    void setPollingActive(bool active);

private:
    void refresh();

    PollProgressBar* m_bar = nullptr;
    QLabel* m_label = nullptr;
    QLabel* m_versionLabel = nullptr;
    int m_secondsLeft = 0;
    int m_intervalSec = 15;
    bool m_active = true;
};

} // namespace yawametrics
